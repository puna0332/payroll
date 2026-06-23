/**
 * OT Day Type Resolver
 * Xác định loại ngày (weekday/saturday/sunday/holiday) cho tính OT
 * Priority: work_calendar override > day-of-week logic
 */

import { PrismaClient } from '@prisma/client';

export type OtDayKind = 'weekday' | 'saturday' | 'sunday' | 'holiday';
export type ScheduleType = 'OFFICE' | 'SIX_DAY';
export type CalendarDayType = 'WORKDAY' | 'SATURDAY' | 'SUNDAY' | 'HOLIDAY' | 'COMPANY_TRIP';

/**
 * Format date as YYYY-MM-DD string for calendar lookup
 */
function dateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Resolve day type from work_calendar database (async)
 */
export async function resolveDayType(
  date: Date,
  scheduleType: ScheduleType,
  prisma: PrismaClient,
): Promise<OtDayKind> {
  const calendar = await prisma.workCalendar.findUnique({
    where: { calendarDate: date },
  });

  if (calendar) {
    return mapCalendarDayType(calendar.dayType as CalendarDayType);
  }

  return resolveFromDayOfWeek(date, scheduleType);
}

/**
 * Resolve day type synchronously using pre-fetched calendar data
 */
export function resolveDayTypeSync(
  date: Date,
  scheduleType: ScheduleType,
  calendarMap: Map<string, CalendarDayType>,
): OtDayKind {
  const key = dateKey(date);
  const calendarType = calendarMap.get(key);

  if (calendarType) {
    return mapCalendarDayType(calendarType);
  }

  return resolveFromDayOfWeek(date, scheduleType);
}

/**
 * Map calendar day type to OT day kind
 */
function mapCalendarDayType(type: CalendarDayType): OtDayKind {
  switch (type) {
    case 'HOLIDAY':
    case 'COMPANY_TRIP':
      return 'holiday';
    case 'SATURDAY':
      return 'saturday';
    case 'SUNDAY':
      return 'sunday';
    case 'WORKDAY':
    default:
      return 'weekday';
  }
}

/**
 * Resolve from day of week based on schedule type
 *
 * OFFICE (5-day): Mon-Fri = weekday, Sat = saturday, Sun = sunday
 * SIX_DAY: Mon-Sat = weekday, Sun = sunday
 */
function resolveFromDayOfWeek(date: Date, scheduleType: ScheduleType): OtDayKind {
  const dow = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  if (dow === 0) return 'sunday';

  if (dow === 6) {
    // Saturday: depends on schedule
    return scheduleType === 'SIX_DAY' ? 'weekday' : 'saturday';
  }

  return 'weekday'; // Mon-Fri
}
