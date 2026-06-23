/**
 * Sync Service — Outbound sync: PostgreSQL → Lark Base
 * Đẩy dữ liệu tính toán từ platform lên Lark Base để C&B xem như view layer.
 * Source of truth vẫn là PostgreSQL; Lark formula/lookup/auto fields được bỏ qua.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import type { LarkBaseClient } from '../../shared/lark/base.js';
import { READ_ONLY_FIELD_TYPES, TABLE_IDS } from '../../shared/lark/config.js';
import { prisma as defaultPrisma } from '../../shared/db/prisma.js';
import type { LarkField, LarkRecord, LarkRecordFields, LarkFieldValue } from '../../shared/lark/types.js';
import { belongsToPeriodByJoinDate } from '../../shared/utils/employment-period.js';

const MODULE = '[Sync:Outbound]';

const OT_BUCKET_FIELDS: Record<string, { hours: string; amount: string; label: string }> = {
  ot_150: {
    hours: 'OT 150% - Ngày thường ca ngày (giờ)',
    amount: 'Tiền OT 150% - Ngày thường ca ngày',
    label: 'OT 150% - Ngày thường ca ngày',
  },
  ot_200: {
    hours: 'OT 200% - Nghỉ/ngày thường đêm rời (giờ)',
    amount: 'Tiền OT 200% - Nghỉ/ngày thường đêm rời',
    label: 'OT 200% - Nghỉ/ngày thường đêm rời',
  },
  ot_210: {
    hours: 'OT 210% - Ngày thường kéo sang đêm (giờ)',
    amount: 'Tiền OT 210% - Ngày thường kéo sang đêm',
    label: 'OT 210% - Ngày thường kéo sang đêm',
  },
  ot_130: {
    hours: 'OT 130% - Ca đêm ngày thường (giờ)',
    amount: 'Tiền OT 130% - Ca đêm ngày thường',
    label: 'OT 130% - Ca đêm ngày thường',
  },
  night_30: {
    hours: 'Ca đêm 30% - Ngày thường (giờ)',
    amount: 'Tiền ca đêm 30% - Ngày thường',
    label: 'Ca đêm 30% - Ngày thường',
  },
  night_50: {
    hours: 'Ca đêm 50% - Ngoài khung 06:00-22:00 (giờ)',
    amount: 'Tiền ca đêm 50% - Ngoài khung 06:00-22:00',
    label: 'Ca đêm 50% - Ngoài khung 06:00-22:00',
  },
  ot_270: {
    hours: 'OT 270% - Ngày nghỉ ca đêm (giờ)',
    amount: 'Tiền OT 270% - Ngày nghỉ ca đêm',
    label: 'OT 270% - Ngày nghỉ ca đêm',
  },
  ot_300: {
    hours: 'OT 300% - Ngày lễ ca ngày (giờ)',
    amount: 'Tiền OT 300% - Ngày lễ ca ngày',
    label: 'OT 300% - Ngày lễ ca ngày',
  },
  ot_390: {
    hours: 'OT 390% - Ngày lễ ca đêm (giờ)',
    amount: 'Tiền OT 390% - Ngày lễ ca đêm',
    label: 'OT 390% - Ngày lễ ca đêm',
  },
};

type SyncCount = { synced: number; created: number; updated: number; skipped: number; errors: number };

type FieldCacheEntry = {
  writableNames: Set<string>;
  allNames: Set<string>;
};

const fieldCache = new Map<string, FieldCacheEntry>();

function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return ((value as { toNumber: () => number }).toNumber)();
  }
  return 0;
}

function dateMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function monthLabel(monthKey: string): string {
  return `Tháng ${monthKey.slice(4, 6)}/${monthKey.slice(0, 4)}`;
}

function monthShortLabel(monthKey: string): string {
  return `${monthKey.slice(4, 6)}/${monthKey.slice(0, 4)}`;
}

function employeeCode(employee: { employeeCode: string | null; userId: string }): string {
  return employee.employeeCode || employee.userId;
}

function personField(openId?: string | null): LarkFieldValue {
  return openId ? [{ id: openId }] : null;
}

function selectEmploymentType(type: string): string {
  if (type === 'M') return 'Management/Expats (M)';
  if (type === 'P') return 'Probation (P)';
  return 'Official staff (O)';
}

function selectPayrollEmploymentType(type: string): string {
  if (type === 'M') return 'Management (M)';
  if (type === 'P') return 'Probation (P)';
  return 'Official (O)';
}

function sourceId(prefix: string, monthKey: string, code: string, suffix?: string): string {
  return [prefix, monthKey, code, suffix].filter(Boolean).join('-');
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

function keyFromFields(fields: LarkRecordFields, keys: string[]): string {
  return keys.map((key) => String(fields[key] ?? '').trim()).join('::');
}

function keyFromRecord(record: LarkRecord, keys: string[]): string {
  return keys.map((key) => getRecordFieldText(record, key).trim()).join('::');
}

async function getFieldCache(larkBase: LarkBaseClient, tableId: string): Promise<FieldCacheEntry> {
  const cached = fieldCache.get(tableId);
  if (cached) return cached;

  const fields = await larkBase.listAllFields(tableId);
  const writableNames = new Set<string>();
  const allNames = new Set<string>();

  for (const field of fields) {
    allNames.add(field.field_name);
    if (isWritableField(field)) {
      writableNames.add(field.field_name);
    }
  }

  const entry = { writableNames, allNames };
  fieldCache.set(tableId, entry);
  return entry;
}

function isWritableField(field: LarkField): boolean {
  if (READ_ONLY_FIELD_TYPES.has(field.type)) return false;
  if (field.field_name.startsWith('↔')) return false;
  return true;
}

async function filterWritable(
  larkBase: LarkBaseClient,
  tableId: string,
  fields: LarkRecordFields,
): Promise<LarkRecordFields> {
  const { writableNames } = await getFieldCache(larkBase, tableId);
  const writable: LarkRecordFields = {};

  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!writableNames.has(name)) continue;
    writable[name] = value;
  }

  return writable;
}

async function upsertRecords(
  larkBase: LarkBaseClient,
  tableId: string,
  keyFields: string[],
  rows: { fields: LarkRecordFields; localLarkRecordId?: string | null; onSynced?: (recordId: string) => Promise<void> }[],
): Promise<SyncCount> {
  const result: SyncCount = { synced: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
  if (rows.length === 0) return result;

  await getFieldCache(larkBase, tableId);
  const existing = await larkBase.listAllRecords(tableId);
  const byId = new Map(existing.map((record) => [record.record_id, record]));
  const byKey = new Map<string, LarkRecord>();

  for (const record of existing) {
    const key = keyFromRecord(record, keyFields);
    if (key) byKey.set(key, record);
  }

  const toUpdate: { record_id: string; fields: LarkRecordFields }[] = [];
  const toCreate: LarkRecordFields[] = [];
  const createCallbacks: ((recordId: string) => Promise<void>)[] = [];
  const updateCallbacks: ((recordId: string) => Promise<void>)[] = [];

  for (const row of rows) {
    const filtered = await filterWritable(larkBase, tableId, row.fields);
    if (Object.keys(filtered).length === 0) {
      result.skipped += 1;
      continue;
    }

    const matched =
      (row.localLarkRecordId ? byId.get(row.localLarkRecordId) : undefined) ??
      byKey.get(keyFromFields(row.fields, keyFields));

    if (matched) {
      toUpdate.push({ record_id: matched.record_id, fields: filtered });
      if (row.onSynced) updateCallbacks.push(() => row.onSynced!(matched.record_id));
    } else {
      toCreate.push(filtered);
      if (row.onSynced) createCallbacks.push(row.onSynced);
    }
  }

  try {
    if (toUpdate.length > 0) {
      await larkBase.batchUpdate(tableId, toUpdate);
      result.updated += toUpdate.length;
      for (const callback of updateCallbacks) await callback('');
    }

    if (toCreate.length > 0) {
      const created = await larkBase.batchCreate(tableId, toCreate);
      result.created += created.length;
      for (let i = 0; i < created.length; i++) {
        const callback = createCallbacks[i];
        if (callback) await callback(created[i].record_id);
      }
    }

    result.synced = result.created + result.updated;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Upsert error for table ${tableId}:`, msg);
    result.errors += toCreate.length + toUpdate.length;
  }

  return result;
}

function emptyBucketFields(): LarkRecordFields {
  const fields: LarkRecordFields = {};
  for (const bucket of Object.values(OT_BUCKET_FIELDS)) {
    fields[bucket.hours] = 0;
    fields[bucket.amount] = 0;
  }
  return fields;
}

function addBucketValues(fields: LarkRecordFields, breakdown: unknown): void {
  Object.assign(fields, emptyBucketFields());
  if (!breakdown || typeof breakdown !== 'object') return;

  for (const [key, value] of Object.entries(breakdown as Record<string, unknown>)) {
    const bucket = OT_BUCKET_FIELDS[key];
    if (!bucket || !value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    fields[bucket.hours] = toNum(row.hours);
    fields[bucket.amount] = toNum(row.amount);
  }
}

function detailBucketLabel(bucketKey: string): string {
  return OT_BUCKET_FIELDS[bucketKey]?.label ?? bucketKey;
}

async function getPeriodOrThrow(prisma: PrismaClient, periodId: string) {
  return prisma.payrollPeriod.findUniqueOrThrow({
    where: { id: periodId },
  });
}

/**
 * Sync Monthly Attendance → Lark Base.
 */
export async function syncMonthlyAttendanceToLark(
  larkBase: LarkBaseClient,
  periodId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<SyncCount> {
  console.log(`${MODULE} Syncing monthly attendance for period ${periodId}...`);

  const period = await getPeriodOrThrow(prisma, periodId);
  const records = await prisma.monthlyAttendance.findMany({
    where: { periodId },
    include: {
      employee: true,
      period: true,
    },
    orderBy: { employee: { employeeCode: 'asc' } },
  });
  const leaveBalances = await prisma.leaveBalance.findMany({
    where: { monthKey: period.monthKey },
  });
  const otMonthlies = await prisma.otMonthly.findMany({
    where: { periodId },
  });

  const leaveByEmployee = new Map(leaveBalances.map((item) => [item.employeeId, item]));
  const otByEmployee = new Map(otMonthlies.map((item) => [item.employeeId, item]));

  const rows = records.filter((record) => belongsToPeriodByJoinDate(period.periodEnd, record.employee.joinDate)).map((record) => {
    const employee = record.employee;
    const code = employeeCode(employee);
    const leave = leaveByEmployee.get(record.employeeId);
    const ot = otByEmployee.get(record.employeeId);
    const fields: LarkRecordFields = {
      User_id: code,
      Employee: personField(employee.openId),
      Department: employee.department,
      'Họ và tên': employee.fullName,
      'Tháng lương': monthLabel(period.monthKey),
      'Ngày bắt đầu tính công': dateMs(period.periodStart),
      'Ngày kết thúc tính công': dateMs(period.periodEnd),
      'Công chuẩn (ngày)': toNum(record.standardDays),
      'Công thực tế(ngày)': toNum(record.actualDays),
      'Ngày vắng mặt': toNum(record.absentDays),
      'Giờ làm thực tế': toNum(record.workHours),
      'Số giờ đi muộn': toNum(record.lateHours),
      'Số giờ về sớm': toNum(record.earlyHours),
      'Giờ nghỉ phép năm': toNum(record.annualLeaveHours),
      'Giờ nghỉ phúc lợi': toNum(record.benefitLeaveHours),
      'Giờ nghỉ phép không lương': toNum(record.unpaidHours),
      'Giờ remote': toNum(record.remoteHours),
      'Số giờ đã nghỉ bù': toNum(record.compLeaveHours),
      'Giờ nghỉ bù hợp lệ': toNum(record.paidCreditHours),
      'Phân loại nhân viên': selectEmploymentType(employee.employmentType),
      'Phép năm sử dụng': toNum(record.annualLeaveHours) / 8,
      'Phép tháng trước': leave ? toNum(leave.opening) : 0,
      'Tồn tháng này': leave ? toNum(leave.closing) : 0,
      'Công thức tồn phép': leave
        ? `Tồn tháng này = ${toNum(leave.opening)} + ${toNum(leave.accrued)} + ${toNum(leave.adjustment)} + ${toNum(leave.seniorityBonus)} - ${toNum(leave.used)} = ${toNum(leave.closing)}`
        : null,
      'Giờ OT': ot ? toNum(ot.totalHours) : 0,
      'Cảnh báo giới hạn OT': ot?.overMonthlyLimit ? 'Vượt hạn mức 40h/tháng' : null,
    };
    addBucketValues(fields, ot?.bucketBreakdown);

    return {
      fields,
      localLarkRecordId: record.larkRecordId,
      onSynced: async (recordId: string) => {
        if (recordId && record.larkRecordId !== recordId) {
          await prisma.monthlyAttendance.update({ where: { id: record.id }, data: { larkRecordId: recordId } });
        }
      },
    };
  });

  return upsertRecords(larkBase, TABLE_IDS.MONTHLY_ATTENDANCE, ['User_id', 'Tháng lương'], rows);
}

/**
 * Sync OT ledger month → Lark Base.
 */
export async function syncOtMonthlyToLark(
  larkBase: LarkBaseClient,
  periodId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<SyncCount> {
  console.log(`${MODULE} Syncing OT monthly ledgers for period ${periodId}...`);

  const period = await getPeriodOrThrow(prisma, periodId);
  const records = await prisma.otMonthly.findMany({
    where: { periodId },
    include: { employee: true },
    orderBy: { employee: { employeeCode: 'asc' } },
  });

  const rows = records.filter((record) => belongsToPeriodByJoinDate(period.periodEnd, record.employee.joinDate)).map((record) => {
    const employee = record.employee;
    const code = employeeCode(employee);
    const fields: LarkRecordFields = {
      'Mã sổ cái OT': sourceId('OTLEDGER', period.monthKey, code),
      'Tháng lương': monthLabel(period.monthKey),
      'Mã nhân viên': code,
      'Tên nhân viên': employee.fullName,
      'Nhân viên Lark': personField(employee.openId),
      'Tổng giờ OT duyệt': toNum(record.totalHours),
      'Tổng giờ OT đã phê duyệt': toNum(record.totalHours),
      'Tổng giờ OT hợp lệ': toNum(record.totalHours),
      'Tổng tiền OT': toNum(record.totalAmount),
      'Hạn mức OT tháng': 40,
      'Giờ OT còn lại': Math.max(0, 40 - toNum(record.totalHours)),
      'Vượt hạn mức 40h/tháng': record.overMonthlyLimit,
      'Cảnh báo tính lương': record.overMonthlyLimit ? 'Vượt hạn mức OT tháng' : null,
      'Trạng thái sổ cái': 'Đã chuẩn hóa',
      'Tóm tắt hệ số OT': Object.entries((record.bucketBreakdown as Record<string, unknown>) ?? {})
        .map(([key, value]) => `${detailBucketLabel(key)}: ${toNum((value as Record<string, unknown>).hours)}h`)
        .join(' | '),
    };
    addBucketValues(fields, record.bucketBreakdown);

    return {
      fields,
      localLarkRecordId: record.larkRecordId,
      onSynced: async (recordId: string) => {
        if (recordId && record.larkRecordId !== recordId) {
          await prisma.otMonthly.update({ where: { id: record.id }, data: { larkRecordId: recordId } });
        }
      },
    };
  });

  return upsertRecords(larkBase, TABLE_IDS.OT_MONTHLY, ['Mã sổ cái OT'], rows);
}

/**
 * Sync OT detail rows → Lark Base.
 */
export async function syncOtDetailsToLark(
  larkBase: LarkBaseClient,
  periodId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<SyncCount> {
  console.log(`${MODULE} Syncing OT details for period ${periodId}...`);

  const period = await getPeriodOrThrow(prisma, periodId);
  const records = await prisma.otDetail.findMany({
    where: { periodId },
    include: { employee: true, approval: true },
    orderBy: [{ workDate: 'asc' }, { employee: { employeeCode: 'asc' } }],
  });

  const rows = records.filter((record) => belongsToPeriodByJoinDate(period.periodEnd, record.employee.joinDate)).map((record) => {
    const employee = record.employee;
    const code = employeeCode(employee);
    const hourlyRate = toNum(record.rate) ? toNum(record.amount) / Math.max(toNum(record.hours), 1) / toNum(record.rate) : 0;
    const fields: LarkRecordFields = {
      'Mã dòng OT': sourceId('OT', period.monthKey, code, `${record.approval?.instanceCode ?? record.id}-${record.bucket}`),
      'Ngày OT': dateMs(record.workDate),
      'Người đề xuất Lark': personField(employee.openId),
      'Mã nhân viên': code,
      'Tên nhân viên': employee.fullName,
      'Số phiếu': record.approval?.serialNumber ?? null,
      'Instance code': record.approval?.instanceCode ?? null,
      'Approval code': record.approval?.approvalCode ?? null,
      'Trạng thái phiếu': record.approval?.status ?? 'APPROVED',
      'Loại ngày': record.dayType,
      'Khung OT': detailBucketLabel(record.bucket),
      'Tháng lương': monthLabel(period.monthKey),
      'Bucket lương OT': detailBucketLabel(record.bucket),
      'Bắt đầu duyệt': dateMs(record.approval?.startTime),
      'Kết thúc duyệt': dateMs(record.approval?.endTime),
      'Hệ số OT': toNum(record.rate),
      'Bắt đầu đoạn tính': dateMs(record.startTime),
      'Kết thúc đoạn tính': dateMs(record.endTime),
      'Giờ đăng ký': toNum(record.approval?.approvedHours),
      'Giờ OT đã phê duyệt': toNum(record.hours),
      'Giờ thực tế': toNum(record.validHours),
      'Giờ bị loại': Math.max(0, toNum(record.hours) - toNum(record.validHours)),
      'Đơn giá giờ': hourlyRate,
      'Lương giờ sau hệ số': hourlyRate * toNum(record.rate),
      'Giờ hợp lệ tính lương': toNum(record.amount) > 0 ? toNum(record.hours) : 0,
      'Tiền OT': toNum(record.amount),
      'Vượt 4h/ngày': toNum(record.hours) > 4,
      'Vượt 40h/tháng': false,
      'Trạng thái đối chiếu': toNum(record.amount) > 0 ? 'Tính lương' : 'Nghỉ bù/không chi trả',
      'Ghi chú tính OT': `${detailBucketLabel(record.bucket)}: ${toNum(record.hours)}h x hệ số ${toNum(record.rate)} = ${toNum(record.amount)}đ`,
    };

    return {
      fields,
      localLarkRecordId: record.larkRecordId,
      onSynced: async (recordId: string) => {
        if (recordId && record.larkRecordId !== recordId) {
          await prisma.otDetail.update({ where: { id: record.id }, data: { larkRecordId: recordId } });
        }
      },
    };
  });

  return upsertRecords(larkBase, TABLE_IDS.OT_DETAILS, ['Mã dòng OT'], rows);
}

/**
 * Sync leave balances → Lark Base.
 */
export async function syncLeaveBalancesToLark(
  larkBase: LarkBaseClient,
  periodId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<SyncCount> {
  console.log(`${MODULE} Syncing leave balances for period ${periodId}...`);

  const period = await getPeriodOrThrow(prisma, periodId);
  const records = await prisma.leaveBalance.findMany({
    where: { monthKey: period.monthKey },
    include: { employee: true },
    orderBy: { employee: { employeeCode: 'asc' } },
  });

  const rows = records.map((record) => {
    const employee = record.employee;
    const code = employeeCode(employee);
    const fields: LarkRecordFields = {
      'Mã nguồn đồng bộ': sourceId('LEAVE', record.monthKey, code),
      SourceID: sourceId('LEAVE', record.monthKey, code),
      'User ID': code,
      'Nhân viên (user_id)': code,
      User: personField(employee.openId),
      'Nhân viên Lark': personField(employee.openId),
      'Ngày join': dateMs(employee.joinDate),
      'Ngày vào công ty': dateMs(employee.joinDate),
      'Phòng ban từ nguồn': employee.department,
      'Loại nhân viên': selectEmploymentType(employee.employmentType),
      Tháng: monthLabel(record.monthKey),
      'Tháng tính phép': monthLabel(record.monthKey),
      'Tồn đầu kỳ (ngày)': toNum(record.opening),
      'Phép được cộng tháng này (ngày)': toNum(record.accrued),
      'Điều chỉnh phép (ngày)': toNum(record.adjustment),
      'Phép thâm niên (ngày)': toNum(record.seniorityBonus),
      'Phép đã nghỉ (ngày)': toNum(record.used),
      'Tồn cuối kỳ (ngày)': toNum(record.closing),
      'tồn tháng trước': toNum(record.opening),
      'Phép năm được cộng': toNum(record.accrued) * 8,
      'Phép năm điều chỉnh': toNum(record.adjustment),
      'Phép năm đã nghỉ': String(toNum(record.used)),
      'Tồn phép hiện có': String(toNum(record.closing)),
      'Trạng thái logic tồn phép': 'Hợp lệ',
      'Ghi chú kiểm tra logic': `Tồn cuối kỳ = ${toNum(record.opening)} + ${toNum(record.accrued)} + ${toNum(record.adjustment)} + ${toNum(record.seniorityBonus)} - ${toNum(record.used)} = ${toNum(record.closing)}`,
    };

    return {
      fields,
      localLarkRecordId: record.larkRecordId,
      onSynced: async (recordId: string) => {
        if (recordId && record.larkRecordId !== recordId) {
          await prisma.leaveBalance.update({ where: { id: record.id }, data: { larkRecordId: recordId } });
        }
      },
    };
  });

  return upsertRecords(larkBase, TABLE_IDS.LEAVE_BALANCE, ['SourceID'], rows);
}

function getAllowance(fullBreakdown: unknown, key: string): number {
  if (!fullBreakdown || typeof fullBreakdown !== 'object') return 0;
  const allowances = (fullBreakdown as Record<string, unknown>).allowances;
  if (!allowances || typeof allowances !== 'object') return 0;
  return toNum((allowances as Record<string, unknown>)[key]);
}

function readPayrollSegments(payslip: { fullBreakdown: Prisma.JsonValue | null }): Record<string, unknown>[] {
  if (!payslip.fullBreakdown || typeof payslip.fullBreakdown !== 'object') return [];
  const segments = (payslip.fullBreakdown as Record<string, unknown>).payrollSegments;
  return Array.isArray(segments) ? segments.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object') : [];
}

function getSegmentNumber(segment: Record<string, unknown> | null, key: string, fallback: number): number {
  if (!segment) return fallback;
  const value = segment[key];
  return value === undefined || value === null ? fallback : toNum(value);
}

function getSegmentLabel(segment: Record<string, unknown> | null, fallback: string): string {
  if (!segment) return fallback;
  const label = segment.label;
  return typeof label === 'string' && label.trim() ? label : fallback;
}

/**
 * Sync Payslips → Lark Base.
 * Chỉ write input fields; formula fields trong Base tự tính.
 */
export async function syncPayslipsToLark(
  larkBase: LarkBaseClient,
  periodId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<SyncCount> {
  console.log(`${MODULE} Syncing payslips for period ${periodId}...`);

  const period = await getPeriodOrThrow(prisma, periodId);
  const payslips = await prisma.payslip.findMany({
    where: { periodId },
    include: {
      employee: true,
    },
    orderBy: { employee: { employeeCode: 'asc' } },
  });

  const monthlyAttendance = await prisma.monthlyAttendance.findMany({ where: { periodId } });
  const attendanceByEmployee = new Map(monthlyAttendance.map((item) => [item.employeeId, item]));

  const rows: { fields: LarkRecordFields; localLarkRecordId?: string | null; onSynced?: (recordId: string) => Promise<void> }[] = [];

  for (const payslip of payslips.filter((item) => belongsToPeriodByJoinDate(period.periodEnd, item.employee.joinDate))) {
    const employee = payslip.employee;
    const code = employeeCode(employee);
    const attendance = attendanceByEmployee.get(payslip.employeeId);
    const segments = readPayrollSegments(payslip);
    const segmentRows = segments.length > 0 ? segments : [null];

    for (const segment of segmentRows) {
      const segmentKey = segment ? String(segment.key ?? segment.kind ?? getSegmentLabel(segment, 'segment')).replace(/\s+/g, '_') : undefined;
      const fullBreakdown = segment && typeof segment.fullBreakdown === 'object' && segment.fullBreakdown !== null
        ? segment.fullBreakdown
        : payslip.fullBreakdown;
      const source = sourceId('PAYSLIP', period.monthKey, code, segmentKey);
      const fields: LarkRecordFields = {
        SourceID: source,
        'Mã số Nhân viên': code,
        'Họ và tên': getSegmentLabel(segment, employee.fullName),
        'Nhân sự': personField(employee.openId),
        'Lao động': employee.department,
        'Phòng ban': employee.department,
        'Chức vụ': employee.position,
        'Phân loại nhân viên': selectPayrollEmploymentType(employee.employmentType),
        Group: employee.scheduleType === 'SIX_DAY' ? 'Ca TTVT' : 'Ca Văn Phòng',
        'Ngày vào cty': dateMs(employee.joinDate),
        'Ngày bắt đầu kỳ công': dateMs(period.periodStart),
        'Ngày kết thúc kỳ công': dateMs(period.periodEnd),
        'Ngày tạo': Date.now(),
        'Tháng lương': monthShortLabel(period.monthKey),
        'Lương cơ bản': getSegmentNumber(segment, 'baseSalary', toNum(payslip.baseSalary)),
        'Phụ cấp cấp bậc': getAllowance(fullBreakdown, 'rank'),
        'Phụ cấp BPQL': 0,
        'Phụ cấp kinh doanh': 0,
        'Phụ cấp kỹ thuật': getAllowance(fullBreakdown, 'technical'),
        'Phụ cấp ngoại ngữ': getAllowance(fullBreakdown, 'language'),
        'Phụ cấp nhà ở': getAllowance(fullBreakdown, 'housing'),
        'Phụ cấp đi lại': getAllowance(fullBreakdown, 'transport'),
        'Phụ cấp ăn uống': getAllowance(fullBreakdown, 'meal'),
        'Phụ cấp điện thoại': getAllowance(fullBreakdown, 'phone'),
        'Phụ cấp chuyên cần': getAllowance(fullBreakdown, 'attendance'),
        'Số ngày chuẩn/tháng': getSegmentNumber(segment, 'standardDays', toNum(payslip.standardDays)),
        'Số ngày làm việc thực tế/tháng': getSegmentNumber(segment, 'actualDays', toNum(payslip.actualDays)),
        'Phép năm đã dùng': attendance ? toNum(attendance.annualLeaveHours) / 8 : 0,
        'Phép phúc lợi': attendance ? toNum(attendance.benefitLeaveHours) / 8 : 0,
        'Vắng mặt(ngày)': attendance ? toNum(attendance.absentDays) : 0,
        'Vắng mặt(giờ)': attendance ? toNum(attendance.absentDays) * 8 : 0,
        'Đi trễ(giờ)': attendance ? toNum(attendance.lateHours) : 0,
        'Về sớm(giờ)': attendance ? toNum(attendance.earlyHours) : 0,
        'Điều chỉnh đi trễ/về sớm (giờ)': 0,
        'OT ngoài giờ': toNum(payslip.otTotalHours),
        'Số giờ đã nghỉ bù': attendance ? toNum(attendance.compLeaveHours) : 0,
        'Số người phụ thuộc': getSegmentNumber(segment, 'dependents', 0),
        'Giảm trừ bản thân': getSegmentNumber(segment, 'personalDeduction', 15_500_000),
        'Điều chỉnh sau thuế': toNum(payslip.afterTaxAdjustment),
        'Đoàn phí': toNum(payslip.unionFee),
        'Cộng khác ①': 0,
        'Cộng khác ② (không thuế)': 0,
      };
      addBucketValues(fields, payslip.otBucketBreakdown);

      rows.push({
        fields,
        localLarkRecordId: segment ? null : payslip.larkRecordId,
        onSynced: segment ? undefined : async (recordId: string) => {
          if (recordId && payslip.larkRecordId !== recordId) {
            await prisma.payslip.update({ where: { id: payslip.id }, data: { larkRecordId: recordId } });
          }
        },
      });
    }
  }

  return upsertRecords(larkBase, TABLE_IDS.PAYSLIPS, ['SourceID'], rows);
}

export async function syncPeriodToLark(
  larkBase: LarkBaseClient,
  periodId: string,
  type: 'attendance' | 'payslips' | 'ot' | 'leave' | 'all' = 'all',
  prisma: PrismaClient = defaultPrisma,
): Promise<Record<string, SyncCount>> {
  const results: Record<string, SyncCount> = {};

  if (type === 'all' || type === 'attendance') {
    results.attendance = await syncMonthlyAttendanceToLark(larkBase, periodId, prisma);
  }
  if (type === 'all' || type === 'ot') {
    results.otMonthly = await syncOtMonthlyToLark(larkBase, periodId, prisma);
    results.otDetails = await syncOtDetailsToLark(larkBase, periodId, prisma);
  }
  if (type === 'all' || type === 'leave') {
    results.leave = await syncLeaveBalancesToLark(larkBase, periodId, prisma);
  }
  if (type === 'all' || type === 'payslips') {
    results.payslips = await syncPayslipsToLark(larkBase, periodId, prisma);
  }

  return results;
}
