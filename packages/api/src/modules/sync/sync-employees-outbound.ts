/**
 * Sync Service — Outbound Employee sync: PostgreSQL -> HR Lark Base
 * Mirrors employee master data without changing the Base schema.
 */

import {
  PrismaClient,
  type Employee,
  type InsurancePolicy,
  type SalaryPolicy,
  type TaxPolicy,
} from '@prisma/client';
import type { LarkBaseClient } from '../../shared/lark/base.js';
import { READ_ONLY_FIELD_TYPES, TABLE_IDS } from '../../shared/lark/config.js';
import type { LarkField, LarkRecord, LarkRecordFields, LarkFieldValue } from '../../shared/lark/types.js';

const MODULE = '[Sync:EmployeeOutbound]';

type BaseSyncCount = { synced: number; created: number; updated: number; skipped: number; errors: number };
type PolicyTableKey = 'salary' | 'tax' | 'insurance';
type PolicySyncResult = Record<PolicyTableKey, BaseSyncCount>;
type PolicyRecordLinks = Partial<Record<PolicyTableKey, Map<string, string>>>;
type PolicySyncOutcome = { summary: PolicySyncResult; links: PolicyRecordLinks };
type SyncCount = BaseSyncCount & { policyTables?: PolicySyncResult; policyLinks?: BaseSyncCount };

type SyncEmployeesToHrBaseOptions = {
  employeeIds?: string[];
};

type EmployeeRow = Employee & {
  larkMetadata: unknown;
  salaryPolicies?: SalaryPolicy[];
  taxPolicies?: TaxPolicy[];
  insurancePolicies?: InsurancePolicy[];
};

type FieldCache = {
  writableNames: Set<string>;
  selectOptions: Map<string, Set<string>>;
};

type ActiveSettingMap = Map<string, string>;

const POLICY_TABLES: Array<{ key: PolicyTableKey; tableId: string }> = [
  { key: 'salary', tableId: TABLE_IDS.SALARY_POLICY },
  { key: 'tax', tableId: TABLE_IDS.TAX_POLICY },
  { key: 'insurance', tableId: TABLE_IDS.INSURANCE_POLICY },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object' && value && 'toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function settingNumber(settings: ActiveSettingMap, category: string, key: string, fallback: number): number {
  const parsed = toNumber(settings.get(`${category}:${key}`));
  return parsed || fallback;
}

function currentPolicy<T extends { isCurrent: boolean; periodKey: string }>(policies?: T[]): T | null {
  if (!policies?.length) return null;
  return policies.find((policy) => policy.isCurrent) ?? policies[0] ?? null;
}

function normalizePeriodKey(periodKey?: string | null): { year: number; month: number; key: string } | null {
  if (!periodKey) return null;
  const compact = periodKey.replace(/\D/g, '');
  if (compact.length < 6) return null;
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

function periodStartMs(periodKey?: string | null): number | null {
  const normalized = normalizePeriodKey(periodKey);
  if (!normalized) return null;
  return Date.UTC(normalized.year, normalized.month - 1, 1);
}

function periodEndMs(periodKey?: string | null): number | null {
  const normalized = normalizePeriodKey(periodKey);
  if (!normalized) return null;
  return Date.UTC(normalized.year, normalized.month, 0);
}

function monthLabelCandidates(periodKey?: string | null): string[] {
  const normalized = normalizePeriodKey(periodKey);
  if (!normalized) return [];
  const mm = String(normalized.month).padStart(2, '0');
  return [
    `Tháng ${mm}/${normalized.year}`,
    `${normalized.key}`,
    `${normalized.year}${mm}`,
    `${mm}/${normalized.year}`,
    `Tháng ${normalized.month}`,
  ];
}

function policyStatusCandidates(isCurrent: boolean): string[] {
  return isCurrent
    ? ['Đang áp dụng', 'Current', 'Active']
    : ['Không áp dụng', 'Inactive', 'Hết hiệu lực'];
}

function linkField(recordId: string): LarkFieldValue {
  return [recordId];
}

function personField(openId?: string | null): LarkFieldValue {
  return openId ? [{ id: openId }] : null;
}

function employeeUserKey(employee: EmployeeRow): string {
  const metadata = isRecord(employee.larkMetadata) ? employee.larkMetadata : {};
  return asText(employee.userId)
    ?? asText(employee.employeeCode)
    ?? asText(metadata.employeeNo)
    ?? employee.userId;
}

function employmentTypeLabel(type: string): string {
  if (type === 'P') return 'Probation';
  if (type === 'PT') return 'Part-time';
  return 'Full-time';
}

function accountStatusLabel(employee: EmployeeRow): string {
  const metadata = isRecord(employee.larkMetadata) ? employee.larkMetadata : {};
  if (employee.status === 'INACTIVE') return 'Đã nghỉ';
  if (metadata.isFrozen === true) return 'Bị khóa';
  return 'Đang hoạt động';
}

function scheduleGroupLabel(scheduleType: string): string {
  if (scheduleType === 'SIX_DAY') return 'TTVT/Kho';
  if (scheduleType === 'OFFICE') return 'Văn phòng';
  return 'Chưa xác định';
}

function scheduleNote(employee: EmployeeRow): string {
  if (employee.scheduleType === 'SIX_DAY') return 'Tính công T2-T7';
  if (employee.scheduleType === 'OFFICE') return 'Tính công T2-T6';
  return 'Chưa xác định lịch làm việc';
}

function getRecordFieldText(record: LarkRecord, fieldName: string): string {
  const value = record.fields[fieldName];
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'object' && item && 'text' in item) return String(item.text ?? '');
      if (typeof item === 'object' && item && 'name' in item) return String(item.name ?? '');
      return String(item ?? '');
    }).join(', ');
  }
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text ?? '');
    if ('name' in value) return String(value.name ?? '');
  }
  return String(value);
}

function extractIds(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(extractIds);
  if (typeof value !== 'object') return [];

  const item = value as Record<string, unknown>;
  return ['id', 'open_id', 'openId', 'user_id', 'userId']
    .map((key) => asText(item[key]))
    .filter((id): id is string => Boolean(id));
}

function getRecordPersonIds(record: LarkRecord, fieldName = 'Nhân sự'): string[] {
  return extractIds(record.fields[fieldName]);
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K | null | undefined, value: V): void {
  if (!key) return;
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function indexRecordsByPerson(records: LarkRecord[]): Map<string, LarkRecord[]> {
  const byPersonId = new Map<string, LarkRecord[]>();
  for (const record of records) {
    for (const id of getRecordPersonIds(record)) {
      pushMapValue(byPersonId, id, record);
    }
  }
  return byPersonId;
}

function indexRecordsByEmployeeKey(records: LarkRecord[], fieldName: string): Map<string, LarkRecord[]> {
  const byKey = new Map<string, LarkRecord[]>();
  for (const record of records) {
    pushMapValue(byKey, getRecordFieldText(record, fieldName).trim(), record);
  }
  return byKey;
}

function employeeKeyCandidates(employee: EmployeeRow): string[] {
  const metadata = isRecord(employee.larkMetadata) ? employee.larkMetadata : {};
  return Array.from(new Set([
    employeeUserKey(employee),
    asText(employee.userId),
    asText(employee.employeeCode),
    asText(metadata.adminUserId),
    asText(metadata.employeeNo),
  ].filter((key): key is string => Boolean(key))));
}

function isWritableField(field: LarkField): boolean {
  if (READ_ONLY_FIELD_TYPES.has(field.type)) return false;
  if (field.field_name.startsWith('↔')) return false;
  return true;
}

function fieldOptions(field: LarkField): Set<string> {
  const property = isRecord(field.property) ? field.property : {};
  const options = Array.isArray(property.options) ? property.options : [];
  return new Set(
    options
      .map((option) => isRecord(option) ? asText(option.name) : null)
      .filter((name): name is string => Boolean(name)),
  );
}

async function getFieldCache(larkBase: LarkBaseClient, tableId: string): Promise<FieldCache> {
  const fields = await larkBase.listAllFields(tableId);
  const writableNames = new Set<string>();
  const selectOptions = new Map<string, Set<string>>();

  for (const field of fields) {
    if (isWritableField(field)) writableNames.add(field.field_name);
    if (field.type === 3) selectOptions.set(field.field_name, fieldOptions(field));
  }

  return { writableNames, selectOptions };
}

async function loadActiveSettings(prisma: PrismaClient): Promise<ActiveSettingMap> {
  const settings = await prisma.payrollSetting.findMany({
    where: {
      policyVersion: { status: 'ACTIVE' },
    },
    select: { category: true, key: true, value: true },
  });
  return new Map(settings.map((setting) => [`${setting.category}:${setting.key}`, setting.value]));
}

function putField(cache: FieldCache, fields: LarkRecordFields, name: string, value: LarkFieldValue): void {
  if (value === undefined) return;
  if (!cache.writableNames.has(name)) return;
  if (value === null) {
    fields[name] = null;
    return;
  }

  const options = cache.selectOptions.get(name);
  if (options && typeof value === 'string' && !options.has(value)) {
    return;
  }

  fields[name] = value;
}

function putFirstAllowed(cache: FieldCache, fields: LarkRecordFields, name: string, values: Array<string | null | undefined>): void {
  if (!cache.writableNames.has(name)) return;
  const options = cache.selectOptions.get(name);
  for (const value of values) {
    if (!value) continue;
    if (!options || options.has(value)) {
      fields[name] = value;
      return;
    }
  }
}

function policyEmploymentTypeCandidates(type: string): string[] {
  if (type === 'P') return ['Probation staff (P)', 'Probation (P)'];
  return ['Official staff (O)', 'Official (O)'];
}

function laborCandidates(employee: EmployeeRow): string[] {
  if (employee.department.toUpperCase() === 'BOD' || employee.employmentType === 'M') return ['BOD'];
  if (employee.scheduleType === 'SIX_DAY') return ['Trực tiếp'];
  return ['Gián tiếp'];
}

function positionCandidates(employee: EmployeeRow): string[] {
  const position = asText(employee.position);
  const candidates = position ? [position] : [];
  const normalized = position?.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized === 'warehouse staff') candidates.push('Warehouse \nStaff');
  if (normalized === 'warehouse leader') candidates.push('Warehouse \nLeader');
  if (normalized === 'sales staff') candidates.push('Sales staff');
  if (employee.department.toUpperCase() === 'BOD' || employee.employmentType === 'M') candidates.push('G.D');
  return Array.from(new Set(candidates));
}

function buildEmployeeFields(
  employee: EmployeeRow,
  cache: FieldCache,
  leaderOpenIdByEmployeeId: Map<string, string | null>,
): LarkRecordFields {
  const metadata = isRecord(employee.larkMetadata) ? employee.larkMetadata : {};
  const fields: LarkRecordFields = {};
  const syncTime = asText(metadata.syncedAt) ? dateMs(asText(metadata.syncedAt)) : Date.now();
  const leaderOpenId = asText(metadata.leaderUserId)
    ? leaderOpenIdByEmployeeId.get(String(metadata.leaderUserId))
    : null;

  putField(cache, fields, 'User_id', employeeUserKey(employee));
  putField(cache, fields, 'Nhân sự', personField(employee.openId));
  putField(cache, fields, 'Quản lý trực tiếp', personField(leaderOpenId));
  putField(cache, fields, 'Phòng ban', employee.department);
  putField(cache, fields, 'Loại nhân sự', employmentTypeLabel(employee.employmentType));
  putField(cache, fields, 'email', employee.email);
  putField(cache, fields, 'mobile', employee.mobile);
  putField(cache, fields, 'join_time', dateMs(employee.joinDate));
  putField(cache, fields, 'Họ và tên', employee.fullName);
  putField(cache, fields, 'Chức danh', employee.position);
  putField(cache, fields, 'Trạng thái tài khoản Lark', accountStatusLabel(employee));
  putField(cache, fields, 'Khối tính công', scheduleGroupLabel(employee.scheduleType));
  putField(cache, fields, 'open_id', employee.openId);
  putField(cache, fields, 'union_id', employee.unionId);
  putField(cache, fields, 'Mô tả trên Lark Admin', asText(metadata.description));
  putField(cache, fields, 'Đồng bộ từ Lark Admin lúc', syncTime);
  putField(cache, fields, 'Ghi chú xác định khối', scheduleNote(employee));

  return fields;
}

function buildPolicyEmployeeFields(
  employee: EmployeeRow,
  cache: FieldCache,
  tableKey: PolicyTableKey,
  activeSettings: ActiveSettingMap,
): LarkRecordFields {
  const fields: LarkRecordFields = {};
  const key = employeeUserKey(employee);
  const metadata = isRecord(employee.larkMetadata) ? employee.larkMetadata : {};
  const salaryPolicy = currentPolicy(employee.salaryPolicies);
  const taxPolicy = currentPolicy(employee.taxPolicies);
  const insurancePolicy = currentPolicy(employee.insurancePolicies);
  const activePolicy = tableKey === 'salary'
    ? salaryPolicy
    : tableKey === 'tax'
      ? taxPolicy
      : insurancePolicy;
  const periodKey = activePolicy?.periodKey
    ?? salaryPolicy?.periodKey
    ?? taxPolicy?.periodKey
    ?? insurancePolicy?.periodKey
    ?? null;
  const isCurrent = activePolicy?.isCurrent ?? true;

  putField(cache, fields, 'Mã số nhân viên', key);
  putField(cache, fields, 'Nhân sự', personField(employee.openId));
  putFirstAllowed(cache, fields, 'Phòng ban', [employee.department]);
  putField(cache, fields, 'Họ và tên', employee.fullName);
  putFirstAllowed(cache, fields, 'Phân loại nhân viên', policyEmploymentTypeCandidates(employee.employmentType));
  putFirstAllowed(cache, fields, 'Lao động', laborCandidates(employee));
  putFirstAllowed(cache, fields, 'Chức vụ', positionCandidates(employee));
  putField(cache, fields, 'Ngày vào công ty', dateMs(employee.joinDate));
  putFirstAllowed(cache, fields, 'Tháng lương', monthLabelCandidates(periodKey));
  putField(cache, fields, 'Ngày bắt đầu kỳ lương', periodStartMs(periodKey));
  putField(cache, fields, 'Ngày kết thúc kỳ lương', periodEndMs(periodKey));
  putField(cache, fields, 'Là chính sách hiện tại', isCurrent);
  putFirstAllowed(cache, fields, 'Trạng thái record chính sách', policyStatusCandidates(isCurrent));
  putField(cache, fields, 'Mã nguồn đồng bộ', `APP_EMPLOYEE_${key}`);
  putField(cache, fields, 'Đồng bộ từ Base nguồn lúc', Date.now());

  if (tableKey === 'salary') {
    putField(cache, fields, 'Ngày kết thúc thử việc', dateMs(asText(metadata.probationEnd)));
    putField(cache, fields, 'Lương offer', toNumber(salaryPolicy?.offerSalary));
    putField(cache, fields, 'Tỷ lệ', toNumber(salaryPolicy?.ratio) || 1);
    putField(cache, fields, 'Lương', toNumber(salaryPolicy?.baseSalary));
    putField(cache, fields, 'Phụ cấp cấp bậc', toNumber(salaryPolicy?.rankAllowance));
    putField(cache, fields, 'Phụ cấp BPQL', toNumber(salaryPolicy?.bpqlAllowance));
    putField(cache, fields, 'Phụ cấp kinh doanh', toNumber(salaryPolicy?.salesAllowance));
    putField(cache, fields, 'Phụ cấp kỹ thuật', toNumber(salaryPolicy?.technicalAllowance));
    putField(cache, fields, 'Phụ cấp ngoại ngữ', toNumber(salaryPolicy?.languageAllowance));
    putField(cache, fields, 'Phụ cấp nhà ở', toNumber(salaryPolicy?.housingAllowance));
    putField(cache, fields, 'Phụ cấp đi lại', toNumber(salaryPolicy?.transportAllowance));
    putField(cache, fields, 'Phụ cấp ăn uống', toNumber(salaryPolicy?.mealAllowance));
    putField(cache, fields, 'Phụ cấp điện thoại', toNumber(salaryPolicy?.phoneAllowance));
    putField(cache, fields, 'Phụ cấp chuyên cần', toNumber(salaryPolicy?.attendanceAllowance));
    putField(cache, fields, 'Nguồn chuẩn tháng làm việc', periodKey ? `App payroll ${periodKey}` : 'App payroll');
  }

  if (tableKey === 'tax') {
    putField(cache, fields, 'Mã số thuế TNCN', asText(taxPolicy?.taxCode));
    putField(cache, fields, 'Giảm trừ bản thân', toNumber(taxPolicy?.personalDeduction));
    putField(cache, fields, 'Số người phụ thuộc', taxPolicy?.dependents ?? 0);
    putField(cache, fields, 'Khóa chính sách hiện tại', `${key}:${periodKey ?? 'current'}:tax`);
    putField(cache, fields, 'Ghi chú kiểm tra trùng', 'Đồng bộ từ app payroll theo User_id');
  }

  if (tableKey === 'insurance') {
    putField(cache, fields, 'Tỷ lệ BHXH NLĐ (%)', settingNumber(activeSettings, 'insurance', 'bhxh_employee_rate', 8));
    putField(cache, fields, 'Tỷ lệ BHYT NLĐ (%)', settingNumber(activeSettings, 'insurance', 'bhyt_employee_rate', 1.5));
    putField(cache, fields, 'Tỷ lệ BHTN NLĐ (%)', settingNumber(activeSettings, 'insurance', 'bhtn_employee_rate', 1));
    putField(cache, fields, 'Tỷ lệ BHXH DN (%)', settingNumber(activeSettings, 'insurance', 'bhxh_employer_rate', 17.5));
    putField(cache, fields, 'Tỷ lệ BHYT DN (%)', settingNumber(activeSettings, 'insurance', 'bhyt_employer_rate', 3));
    putField(cache, fields, 'Tỷ lệ BHTN DN (%)', settingNumber(activeSettings, 'insurance', 'bhtn_employer_rate', 1));
    putField(cache, fields, 'Lương offer snapshot', toNumber(insurancePolicy?.insuranceBasis));
    putField(cache, fields, 'BHXH NLĐ snapshot', toNumber(insurancePolicy?.bhxhEmployee));
    putField(cache, fields, 'BHYT NLĐ snapshot', toNumber(insurancePolicy?.bhytEmployee));
    putField(cache, fields, 'BHTN NLĐ snapshot', toNumber(insurancePolicy?.bhtnEmployee));
    putField(cache, fields, 'Tổng BH NLĐ snapshot', toNumber(insurancePolicy?.totalEmployee));
    putField(cache, fields, 'BHXH DN snapshot', toNumber(insurancePolicy?.bhxhEmployer));
    putField(cache, fields, 'BHYT DN snapshot', toNumber(insurancePolicy?.bhytEmployer));
    putField(cache, fields, 'BHTN DN snapshot', toNumber(insurancePolicy?.bhtnEmployer));
    putField(cache, fields, 'Tổng BH DN snapshot', toNumber(insurancePolicy?.totalEmployer));
    putField(cache, fields, 'Tổng chi phí BH snapshot', toNumber(insurancePolicy?.grandTotal));
    putField(cache, fields, 'Ghi chú tự động tính BH', 'Đồng bộ từ app payroll; formula/lookup trong Base giữ nguyên.');
    putField(cache, fields, 'Tính BH lúc', Date.now());
    putField(cache, fields, 'Khóa chính sách hiện tại', `${key}:${periodKey ?? 'current'}:insurance`);
    putField(cache, fields, 'Ghi chú kiểm tra trùng', 'Đồng bộ từ app payroll theo User_id');
  }

  return fields;
}

async function syncEmployeeMasterToPolicyTable(
  larkBase: LarkBaseClient,
  tableId: string,
  tableKey: PolicyTableKey,
  employees: EmployeeRow[],
  activeSettings: ActiveSettingMap,
): Promise<BaseSyncCount & { recordIdsByEmployeeId: Map<string, string> }> {
  const result: BaseSyncCount = { synced: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
  const recordIdsByEmployeeId = new Map<string, string>();
  const [cache, records] = await Promise.all([
    getFieldCache(larkBase, tableId),
    larkBase.listAllRecords(tableId),
  ]);
  const byPersonId = indexRecordsByPerson(records);
  const byEmployeeCode = indexRecordsByEmployeeKey(records, 'Mã số nhân viên');
  const updates: { record_id: string; fields: LarkRecordFields }[] = [];
  const creates: { employeeId: string; fields: LarkRecordFields }[] = [];

  for (const employee of employees) {
    const matches = new Map<string, LarkRecord>();

    if (employee.openId) {
      for (const record of byPersonId.get(employee.openId) ?? []) {
        matches.set(record.record_id, record);
      }
    }

    for (const key of employeeKeyCandidates(employee)) {
      for (const record of byEmployeeCode.get(key) ?? []) {
        matches.set(record.record_id, record);
      }
    }

    const fields = buildPolicyEmployeeFields(employee, cache, tableKey, activeSettings);
    if (Object.keys(fields).length === 0) {
      result.skipped += 1;
      continue;
    }

    if (matches.size === 0) {
      creates.push({ employeeId: employee.id, fields });
    } else {
      const matchedRecords = Array.from(matches.values());
      const first = matchedRecords[0];
      if (first) recordIdsByEmployeeId.set(employee.id, first.record_id);
      for (const record of matchedRecords) {
        updates.push({ record_id: record.record_id, fields });
      }
    }
  }

  if (updates.length > 0) {
    await larkBase.batchUpdate(tableId, updates);
    result.updated = updates.length;
  }
  if (creates.length > 0) {
    const created = await larkBase.batchCreate(tableId, creates.map((item) => item.fields));
    result.created = created.length;
    for (let i = 0; i < created.length; i++) {
      const employeeId = creates[i]?.employeeId;
      if (employeeId && created[i]?.record_id) {
        recordIdsByEmployeeId.set(employeeId, created[i].record_id);
      }
    }
  }

  result.synced = result.created + result.updated;
  return { ...result, recordIdsByEmployeeId };
}

async function syncEmployeeMasterToPolicyTables(
  larkBase: LarkBaseClient,
  employees: EmployeeRow[],
  activeSettings: ActiveSettingMap,
): Promise<PolicySyncOutcome> {
  const summary = {} as PolicySyncResult;
  const links: PolicyRecordLinks = {};
  for (const table of POLICY_TABLES) {
    try {
      const result = await syncEmployeeMasterToPolicyTable(larkBase, table.tableId, table.key, employees, activeSettings);
      const { recordIdsByEmployeeId, ...counts } = result;
      summary[table.key] = counts;
      links[table.key] = recordIdsByEmployeeId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`${MODULE} Policy table ${table.key} update error:`, msg);
      summary[table.key] = { synced: 0, created: 0, updated: 0, skipped: employees.length, errors: employees.length };
      links[table.key] = new Map<string, string>();
    }
  }
  return { summary, links };
}

async function syncHrCurrentPolicyLinks(
  larkBase: LarkBaseClient,
  cache: FieldCache,
  hrRecordIdsByEmployeeId: Map<string, string>,
  policyLinks: PolicyRecordLinks,
): Promise<BaseSyncCount> {
  const result: BaseSyncCount = { synced: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
  const updates: { record_id: string; fields: LarkRecordFields }[] = [];

  for (const [employeeId, hrRecordId] of hrRecordIdsByEmployeeId.entries()) {
    const fields: LarkRecordFields = {};
    const salaryRecordId = policyLinks.salary?.get(employeeId);
    const taxRecordId = policyLinks.tax?.get(employeeId);
    const insuranceRecordId = policyLinks.insurance?.get(employeeId);

    if (salaryRecordId) {
      putField(cache, fields, 'Chính sách lương, phúc lợi hiện tại', linkField(salaryRecordId));
    }
    if (taxRecordId) {
      putField(cache, fields, 'Thông tin thuế, bảo hiểm hiện tại', linkField(taxRecordId));
    }
    if (insuranceRecordId) {
      putField(cache, fields, 'Chính sách BHXH, BHYT, BHTN hiện tại', linkField(insuranceRecordId));
    }

    if (Object.keys(fields).length === 0) {
      result.skipped += 1;
      continue;
    }
    updates.push({ record_id: hrRecordId, fields });
  }

  if (updates.length > 0) {
    await larkBase.batchUpdate(TABLE_IDS.HR, updates);
    result.updated = updates.length;
  }

  result.synced = result.created + result.updated;
  return result;
}

export async function syncEmployeesToHrBase(
  prisma: PrismaClient,
  larkBase: LarkBaseClient,
  options: SyncEmployeesToHrBaseOptions = {},
): Promise<SyncCount> {
  console.log(`${MODULE} Starting employee outbound sync to HR Base...`);
  const result: SyncCount = { synced: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
  const cache = await getFieldCache(larkBase, TABLE_IDS.HR);
  const employeeWhere = options.employeeIds?.length
    ? { id: { in: options.employeeIds } }
    : undefined;
  const [employees, leaderCandidates, existingRecords, activeSettings] = await Promise.all([
    prisma.employee.findMany({
      where: employeeWhere,
      orderBy: [{ employeeCode: 'asc' }, { fullName: 'asc' }],
      include: {
        salaryPolicies: {
          orderBy: [{ periodKey: 'desc' }, { updatedAt: 'desc' }],
          take: 5,
        },
        taxPolicies: {
          orderBy: [{ periodKey: 'desc' }, { updatedAt: 'desc' }],
          take: 5,
        },
        insurancePolicies: {
          orderBy: [{ periodKey: 'desc' }, { updatedAt: 'desc' }],
          take: 5,
        },
      },
    }) as Promise<EmployeeRow[]>,
    prisma.employee.findMany({
      select: { userId: true, openId: true },
    }),
    larkBase.listAllRecords(TABLE_IDS.HR),
    loadActiveSettings(prisma),
  ]);

  const byRecordId = new Map(existingRecords.map((record) => [record.record_id, record]));
  const byPersonId = indexRecordsByPerson(existingRecords);
  const byOpenId = indexRecordsByEmployeeKey(existingRecords, 'open_id');
  const byUserKey = new Map<string, LarkRecord>();
  for (const record of existingRecords) {
    const key = getRecordFieldText(record, 'User_id').trim();
    if (key) byUserKey.set(key, record);
  }

  const leaderOpenIdByUserId = new Map(leaderCandidates.map((employee) => [employee.userId, employee.openId]));
  const updates: { record_id: string; fields: LarkRecordFields; employeeId: string }[] = [];
  const creates: { fields: LarkRecordFields; employeeId: string }[] = [];
  const hrRecordIdsByEmployeeId = new Map<string, string>();

  for (const employee of employees) {
    const fields = buildEmployeeFields(employee, cache, leaderOpenIdByUserId);
    if (Object.keys(fields).length === 0) {
      result.skipped += 1;
      continue;
    }

    const matched = (employee.larkRecordId ? byRecordId.get(employee.larkRecordId) : undefined)
      ?? (employee.openId ? byOpenId.get(employee.openId)?.[0] : undefined)
      ?? (employee.openId ? byPersonId.get(employee.openId)?.[0] : undefined)
      ?? byUserKey.get(employeeUserKey(employee));

    if (matched) {
      updates.push({ record_id: matched.record_id, fields, employeeId: employee.id });
      hrRecordIdsByEmployeeId.set(employee.id, matched.record_id);
    } else {
      creates.push({ fields, employeeId: employee.id });
    }
  }

  try {
    if (updates.length > 0) {
      await larkBase.batchUpdate(TABLE_IDS.HR, updates.map(({ record_id, fields }) => ({ record_id, fields })));
      result.updated += updates.length;
      for (const item of updates) {
        await prisma.employee.update({
          where: { id: item.employeeId },
          data: { larkRecordId: item.record_id },
        });
      }
    }

    if (creates.length > 0) {
      const created = await larkBase.batchCreate(TABLE_IDS.HR, creates.map(({ fields }) => fields));
      result.created += created.length;
      for (let i = 0; i < created.length; i++) {
        const employeeId = creates[i]?.employeeId;
        if (!employeeId) continue;
        hrRecordIdsByEmployeeId.set(employeeId, created[i].record_id);
        await prisma.employee.update({
          where: { id: employeeId },
          data: { larkRecordId: created[i].record_id },
        });
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Upsert HR Base error:`, msg);
    result.errors += updates.length + creates.length;
  }

  const policyOutcome = await syncEmployeeMasterToPolicyTables(larkBase, employees, activeSettings);
  result.policyTables = policyOutcome.summary;
  result.errors += Object.values(result.policyTables).reduce((sum, item) => sum + item.errors, 0);
  try {
    result.policyLinks = await syncHrCurrentPolicyLinks(larkBase, cache, hrRecordIdsByEmployeeId, policyOutcome.links);
    result.updated += result.policyLinks.updated;
    result.skipped += result.policyLinks.skipped;
    result.errors += result.policyLinks.errors;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} HR policy link update error:`, msg);
    result.policyLinks = { synced: 0, created: 0, updated: 0, skipped: employees.length, errors: employees.length };
    result.errors += employees.length;
  }
  result.synced = result.created + result.updated;
  console.log(`${MODULE} Done — created: ${result.created}, updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors}`);
  return result;
}
