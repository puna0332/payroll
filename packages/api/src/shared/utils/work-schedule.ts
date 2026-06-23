export type EffectiveScheduleType = 'OFFICE' | 'SIX_DAY';
export type EffectiveOtScheduleType = 'office' | 'six_day';

type EmployeeScheduleInput = {
  scheduleType?: string | null;
  employeeCode?: string | null;
  userId?: string | null;
  department?: string | null;
  fullName?: string | null;
  larkMetadata?: unknown;
};

const EQUIPMENT_WAREHOUSE_CODES = new Set([
  'ASV005',
  'ASV008',
  'ASV016',
  'ASV017',
  'ASV018',
  'ASV023',
]);

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeEmployeeCodeForSchedule(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const asv = trimmed.match(/^ASV0*(\d+)$/i);
    if (asv) return `ASV${asv[1].padStart(3, '0')}`;
    const numeric = trimmed.match(/^0*(\d{1,3})$/);
    if (numeric) return `ASV${numeric[1].padStart(3, '0')}`;
  }
  return null;
}

export function isEquipmentWarehouseEmployee(employee: EmployeeScheduleInput): boolean {
  const meta = employee.larkMetadata && typeof employee.larkMetadata === 'object'
    ? employee.larkMetadata as Record<string, unknown>
    : {};
  const code = normalizeEmployeeCodeForSchedule(
    employee.employeeCode,
    employee.userId,
    meta.employeeNo,
    meta.employeeCode,
    meta.staffCode,
  );
  if (code && EQUIPMENT_WAREHOUSE_CODES.has(code)) return true;

  const department = normalizeSearchText(employee.department ?? '');
  return (
    department.includes('ttvt') ||
    department.includes('kho') ||
    department.includes('kho bai') ||
    department.includes('thiet bi') ||
    department.includes('\u6a5f\u6750')
  );
}

export function resolveEffectiveScheduleType(employee: EmployeeScheduleInput): EffectiveScheduleType {
  // Business rule: only Equipment/Warehouse works Mon-Sat; everyone else rests Sat+Sun.
  return isEquipmentWarehouseEmployee(employee) ? 'SIX_DAY' : 'OFFICE';
}

export function toOtScheduleType(scheduleType: EffectiveScheduleType | string | null | undefined): EffectiveOtScheduleType {
  return scheduleType === 'SIX_DAY' ? 'six_day' : 'office';
}

export function resolveEffectiveOtScheduleType(employee: EmployeeScheduleInput): EffectiveOtScheduleType {
  return toOtScheduleType(resolveEffectiveScheduleType(employee));
}
