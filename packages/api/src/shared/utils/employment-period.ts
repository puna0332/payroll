type DateInput = Date | string | null | undefined;

function toUtcDateOnlyMs(value: DateInput): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isPeriodBeforeJoinDate(periodEnd: DateInput, joinDate: DateInput): boolean {
  const periodEndMs = toUtcDateOnlyMs(periodEnd);
  const joinDateMs = toUtcDateOnlyMs(joinDate);
  if (periodEndMs === null || joinDateMs === null) return false;
  return periodEndMs < joinDateMs;
}

export function belongsToPeriodByJoinDate(periodEnd: DateInput, joinDate: DateInput): boolean {
  return !isPeriodBeforeJoinDate(periodEnd, joinDate);
}
