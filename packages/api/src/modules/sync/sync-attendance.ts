/**
 * Sync Service — Inbound Attendance sync từ Lark
 * Đồng bộ chấm công hàng ngày từ Lark Attendance API → PostgreSQL
 */

import { PrismaClient } from '@prisma/client';
import type { LarkAttendanceClient } from '../../shared/lark/attendance.js';
import { prisma as defaultPrisma } from '../../shared/db/prisma.js';
import { STANDARD_HOURS, STANDARD_CHECKIN, STANDARD_CHECKOUT } from '../../config/constants.js';
import { attendanceKey } from '../../shared/utils/idempotency.js';
import type { AttendanceFlowRecord } from '../../shared/lark/types.js';
import { getLateEarlyRoundingRules, roundLateEarlyHours } from '../attendance/late-early-rounding.js';

const MODULE = '[Sync:Attendance]';

/**
 * Parse giờ HH:MM → phút từ 00:00
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Extract minutes-of-day from a Date in VN timezone.
 */
function dateToMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

/**
 * Tính late hours (giờ đi trễ) dựa trên check-in time vs shift schedule
 * Uses shift check-in time if available, otherwise falls back to STANDARD_CHECKIN
 */
function calcLateHours(checkInTime: Date | null, shiftCheckIn: Date | null): number {
  if (!checkInTime) return 0;
  const checkinMinutes = dateToMinutes(checkInTime);
  const standardMinutes = shiftCheckIn
    ? dateToMinutes(shiftCheckIn)
    : timeToMinutes(STANDARD_CHECKIN);
  const diff = checkinMinutes - standardMinutes;
  return diff > 0 ? Math.round((diff / 60) * 100) / 100 : 0;
}

/**
 * Tính early hours (giờ về sớm) dựa trên check-out time vs shift schedule
 * Không áp dụng grace period — tính chính xác
 */
function calcEarlyHours(checkOutTime: Date | null, shiftCheckOut: Date | null): number {
  if (!checkOutTime) return 0;
  const checkoutMinutes = dateToMinutes(checkOutTime);
  const standardMinutes = shiftCheckOut
    ? dateToMinutes(shiftCheckOut)
    : timeToMinutes(STANDARD_CHECKOUT);
  const diff = standardMinutes - checkoutMinutes;
  return diff > 0 ? Math.round((diff / 60) * 100) / 100 : 0;
}

/**
 * Tính work hours theo công ca chuẩn:
 * - effectiveIn = max(checkIn, shiftStart) — vào sớm KHÔNG tính
 * - effectiveOut = min(checkOut, shiftEnd) — ra trễ KHÔNG tính (không bù trừ)
 * - Trừ 1h nghỉ trưa (12:00-13:00)
 * - Dùng minute-level precision (bỏ giây) — khớp với calcLateHours/calcEarlyHours
 * → Giờ thiếu = Đi trễ + Về sớm (chính xác từng phút)
 */
function calcWorkHours(checkIn: Date | null, checkOut: Date | null, shiftCheckIn: Date | null = null, shiftCheckOut: Date | null = null, stdHours: number = STANDARD_HOURS): number {
  if (!checkIn || !checkOut) return 0;
  // Effective check-in: max(actualCheckIn, shiftStart) — don't count early arrival
  let effectiveInMin = dateToMinutes(checkIn);
  const shiftInMin = shiftCheckIn ? dateToMinutes(shiftCheckIn) : timeToMinutes(STANDARD_CHECKIN);
  if (effectiveInMin < shiftInMin) {
    effectiveInMin = shiftInMin;
  }
  // Effective check-out: min(actualCheckOut, shiftEnd) — don't count staying late
  let effectiveOutMin = dateToMinutes(checkOut);
  const shiftOutMin = shiftCheckOut ? dateToMinutes(shiftCheckOut) : timeToMinutes(STANDARD_CHECKOUT);
  if (effectiveOutMin > shiftOutMin) {
    effectiveOutMin = shiftOutMin;
  }
  let minutes = effectiveOutMin - effectiveInMin;
  // Trừ 1h nghỉ trưa nếu làm qua buổi trưa
  if (effectiveInMin < 720 && effectiveOutMin >= 780) { // 12:00=720, 13:00=780
    minutes -= 60;
  }
  const hours = Math.max(0, minutes / 60);
  return Math.min(Math.round(hours * 100) / 100, stdHours);
}

/**
 * Tính standard hours từ shift schedule (shift check-in → shift check-out, trừ 1h nghỉ)
 * Falls back to STANDARD_HOURS if no shift
 */
function calcStandardHours(shiftCheckIn: Date | null, shiftCheckOut: Date | null): number {
  if (!shiftCheckIn || !shiftCheckOut) return STANDARD_HOURS;
  const diffH = (shiftCheckOut.getTime() - shiftCheckIn.getTime()) / (1000 * 60 * 60);
  // Trừ 1h nghỉ trưa nếu ca qua buổi trưa
  if (dateToMinutes(shiftCheckIn) < 720 && dateToMinutes(shiftCheckOut) >= 780) {
    return Math.max(0, diffH - 1);
  }
  return Math.max(0, diffH);
}

/**
 * OT sơ bộ: hiện tại KHÔNG tự tính OT
 * OT chỉ được tính khi có phiếu OT đã duyệt
 * → Luôn trả 0 ở giai đoạn sync
 */
function calcPreliminaryOT(_workHours: number, _stdHours: number = STANDARD_HOURS): number {
  return 0; // OT requires approved request, not auto-calculated
}

/**
 * Tính missing hours: phần giờ thiếu so với standard
 */
function calcMissingHours(workHours: number, stdHours: number = STANDARD_HOURS): number {
  const missing = stdHours - workHours;
  return missing > 0 ? Math.round(missing * 100) / 100 : 0;
}

function ymdInVn(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function utcDateFromYmd(ymd: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function storageDateFromFlow(flow: AttendanceFlowRecord): Date | null {
  const ts = Number(flow.check_time);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  // /attendance/daily displays DB dates as +1 day to align with Lark task dates.
  // Store raw flow records using the same convention so today's check-in appears on today's UI cell.
  return addUtcDays(utcDateFromYmd(ymdInVn(new Date(ts * 1000))), -1);
}

function isActualToday(storageDate: Date): boolean {
  return ymdInVn(addUtcDays(storageDate, 1)) === ymdInVn(new Date());
}

function flowTime(flow: AttendanceFlowRecord): Date {
  return new Date(Number(flow.check_time) * 1000);
}

function buildRawDataFromFlows(flows: AttendanceFlowRecord[], checkIn: Date | null, checkOut: Date | null): object {
  return {
    source: 'user_flows/query',
    flow_records: flows,
    records: [{
      check_in_record: checkIn ? flows.find((flow) => flowTime(flow).getTime() === checkIn.getTime()) ?? null : null,
      check_out_record: checkOut ? flows.find((flow) => flowTime(flow).getTime() === checkOut.getTime()) ?? null : null,
    }],
  };
}

/**
 * Kết luận ngày chấm công
 */
function getConclusion(workHours: number, checkIn: Date | null, checkOut: Date | null, stdHours: number = STANDARD_HOURS): string {
  if (!checkIn && !checkOut) return 'Không chấm công';
  if (!checkIn) return 'Thiếu check-in';
  if (!checkOut) return 'Thiếu check-out';
  if (workHours >= stdHours) return 'Đủ công';
  return 'Thiếu công';
}

export interface SyncAttendanceOptions {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  employeeIds?: string[]; // Filter specific employees
}

export async function syncAttendanceFromLark(
  larkAttendance: LarkAttendanceClient,
  options: SyncAttendanceOptions,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ created: number; updated: number; skipped: number }> {
  console.log(`${MODULE} Syncing attendance: ${options.startDate} → ${options.endDate}`);
  const lateEarlyRoundingRules = await getLateEarlyRoundingRules(prisma);

  // Lấy danh sách nhân viên active
  const employees = await prisma.employee.findMany({
    where: {
      status: 'ACTIVE',
      ...(options.employeeIds?.length ? { id: { in: options.employeeIds } } : {}),
    },
    select: { id: true, userId: true, openId: true, employeeCode: true, fullName: true },
  });

  if (employees.length === 0) {
    console.warn(`${MODULE} No active employees found`);
    return { created: 0, updated: 0, skipped: 0 };
  }

  // Lấy user_ids cho Lark API (dùng userId)
  const userIds = employees
    .map(e => e.userId)
    .filter(Boolean);

  console.log(`${MODULE} Querying ${userIds.length} users from Lark Attendance API (user_tasks + user_flows)`);

  // Query attendance tasks (daily results) and raw flows (same-day partial check-ins).
  const [tasks, flows] = await Promise.all([
    larkAttendance.getUserTasks(userIds, options.startDate, options.endDate),
    larkAttendance.queryUserFlows(userIds, options.startDate, options.endDate).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`${MODULE} Raw user_flows query failed; continuing with user_tasks only: ${msg}`);
      return [] as AttendanceFlowRecord[];
    }),
  ]);

  console.log(`${MODULE} Received ${tasks.length} task results`);
  console.log(`${MODULE} Received ${flows.length} raw flow records`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Build multiple maps for flexible matching
  // Map: userId → employee, openId → employee, employeeCode → employee
  const byUserId = new Map<string, typeof employees[0]>();
  const byOpenId = new Map<string, typeof employees[0]>();
  const byCode = new Map<string, typeof employees[0]>();
  for (const e of employees) {
    if (e.userId) byUserId.set(e.userId, e);
    if (e.openId) byOpenId.set(e.openId, e);
    if (e.employeeCode) byCode.set(e.employeeCode, e);
  }

  // Lark attendance response returns user_id in employee_id format (Lark internal UUID)
  // which may differ from what's stored in our DB. Build reverse mapping:
  // attendanceUserId → dbEmployee
  const empMap = new Map<string, typeof employees[0]>();

  // Pre-populate with known mappings
  for (const e of employees) {
    if (e.userId) empMap.set(e.userId, e);
    if (e.openId) empMap.set(e.openId, e);
    if (e.employeeCode) empMap.set(e.employeeCode, e);
  }

  // After first batch, dynamically detect: if tasks[0].user_id not in empMap,
  // match via employee_name or position in the task results
  if (tasks.length > 0) {
    const sampleIds = tasks.slice(0, 3).map(t => t.user_id);
    console.log(`${MODULE} Sample task user_ids: ${JSON.stringify(sampleIds)}`);
    console.log(`${MODULE} empMap has ${empMap.size} keys`);

    // Build name → employee map as fallback matcher
    const byName = new Map<string, typeof employees[0]>();
    for (const e of employees) {
      const fullEmp = await prisma.employee.findUnique({
        where: { id: e.id },
        select: { id: true, userId: true, openId: true, fullName: true },
      });
      if (fullEmp?.fullName) {
        byName.set(fullEmp.fullName.toLowerCase().trim(), { ...e });
      }
    }

    // Match tasks by employee_name if available
    for (const task of tasks) {
      if (!empMap.has(task.user_id) && task.employee_name) {
        const match = byName.get(task.employee_name.toLowerCase().trim());
        if (match) {
          empMap.set(task.user_id, match);
          console.log(`${MODULE} Mapped ${task.user_id} → ${match.userId} (${task.employee_name})`);
        }
      }
    }
  }

  let matchCount = 0;
  for (const task of tasks) {
    const employee = empMap.get(task.user_id);
    if (!employee) {
      if (matchCount === 0 && skipped < 3) {
        console.log(`${MODULE} SKIP: task.user_id="${task.user_id}" not found in empMap`);
      }
      skipped++;
      continue;
    }
    matchCount++;
    if (matchCount <= 2) {
      console.log(`${MODULE} MATCH: ${task.user_id} → emp.id=${employee.id?.substring(0,8)}, day=${task.day}`);
    }

    // Parse day (integer YYYYMMDD) to Date
    const dayStr = String(task.day || 0);
    if (dayStr.length < 8) {
      skipped++;
      continue;
    }

    // Use Lark's day field as canonical attendance date
    // Lark assigns shift dates consistently (e.g., day=20260419 = the shift assigned for that date)
    const attendanceDate = new Date(
      parseInt(dayStr.slice(0, 4)),
      parseInt(dayStr.slice(4, 6)) - 1,
      parseInt(dayStr.slice(6, 8)),
    );
    if (!Number.isFinite(attendanceDate.getTime())) {
      console.warn(`${MODULE} Invalid date ${dayStr} for ${task.user_id}, skipping`);
      skipped++;
      continue;
    }

    // Extract check-in / check-out from records array
    const rec = task.records?.[0]; // First shift record
    let checkIn: Date | null = null;
    let checkOut: Date | null = null;

    if (rec?.check_in_record?.check_time) {
      checkIn = new Date(parseInt(rec.check_in_record.check_time) * 1000);
    }
    if (rec?.check_out_record?.check_time) {
      checkOut = new Date(parseInt(rec.check_out_record.check_time) * 1000);
    }

    const displayDate = addUtcDays(attendanceDate, 1);
    const isTodayOrFutureDisplayDate = ymdInVn(displayDate) >= ymdInVn(new Date());
    if (!checkIn && !checkOut && isTodayOrFutureDisplayDate) {
      skipped++;
      continue;
    }

    // Extract shift schedule times (Lark returns Unix timestamps in seconds)
    // Filter out invalid timestamps (0 or same start/end = no real shift)
    const MIN_VALID_TS = 1577836800; // 2020-01-01 UTC
    let shiftCheckIn: Date | null = null;
    let shiftCheckOut: Date | null = null;
    const shiftInTs = rec?.check_in_shift_time ? parseInt(rec.check_in_shift_time) : 0;
    const shiftOutTs = rec?.check_out_shift_time ? parseInt(rec.check_out_shift_time) : 0;
    if (shiftInTs > MIN_VALID_TS && shiftOutTs > MIN_VALID_TS && shiftInTs !== shiftOutTs) {
      shiftCheckIn = new Date(shiftInTs * 1000);
      shiftCheckOut = new Date(shiftOutTs * 1000);
    }

    const stdHours = calcStandardHours(shiftCheckIn, shiftCheckOut);
    const workHours = calcWorkHours(checkIn, checkOut, shiftCheckIn, shiftCheckOut, stdHours);
    const rawLateHours = calcLateHours(checkIn, shiftCheckIn);
    const rawEarlyHours = calcEarlyHours(checkOut, shiftCheckOut);
    const lateHours = roundLateEarlyHours(rawLateHours, lateEarlyRoundingRules);
    const earlyHours = roundLateEarlyHours(rawEarlyHours, lateEarlyRoundingRules);
    const otHours = calcPreliminaryOT(workHours, stdHours);
    // missingHours = lateHours + earlyHours (guaranteed consistency, no rounding drift)
    const missingHours = Math.round((lateHours + earlyHours) * 100) / 100;

    // Conclusion from Lark result or calculated
    let conclusion = getConclusion(workHours, checkIn, checkOut, stdHours);
    const inResult = (rec as Record<string, unknown>)?.check_in_result as string | undefined;
    const outResult = (rec as Record<string, unknown>)?.check_out_result as string | undefined;
    if (inResult === 'Late' || outResult === 'Early') {
      conclusion = inResult === 'Late' ? 'Đi trễ' : 'Về sớm';
    }

    const idempKey = attendanceKey(employee.userId || employee.id, attendanceDate.toISOString().split('T')[0]);

    const data = {
      attendanceDate,
      checkIn,
      checkOut,
      workHours,
      rawLateHours,
      rawEarlyHours,
      lateHours,
      earlyHours,
      otHoursPreliminary: otHours,
      missingHours,
      conclusion,
      source: 'LARK_SYNC' as const,
      rawData: task as unknown as object,
      syncedAt: new Date(),
    };

    try {
      const existing = await prisma.dailyAttendance.findFirst({
        where: {
          OR: [
            { idempotencyKey: idempKey },
            { employeeId: employee.id, attendanceDate },
          ],
        },
      });

      if (existing) {
        await prisma.dailyAttendance.update({
          where: { id: existing.id },
          data,
        });
        updated++;
      } else {
        await prisma.dailyAttendance.create({
          data: {
            ...data,
            employeeId: employee.id,
            idempotencyKey: idempKey,
          },
        });
        created++;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`${MODULE} Error processing task for ${employee.userId} on ${dayStr}:`, msg);
      skipped++;
    }
  }

  const flowGroups = new Map<string, {
    employee: typeof employees[0];
    storageDate: Date;
    flows: AttendanceFlowRecord[];
  }>();

  for (const flow of flows) {
    const employee = empMap.get(flow.user_id) ?? byUserId.get(flow.user_id) ?? byOpenId.get(flow.user_id) ?? byCode.get(flow.user_id);
    const storageDate = storageDateFromFlow(flow);
    if (!employee || !storageDate) {
      skipped++;
      continue;
    }

    const key = `${employee.id}:${storageDate.toISOString().slice(0, 10)}`;
    const existing = flowGroups.get(key);
    if (existing) {
      existing.flows.push(flow);
    } else {
      flowGroups.set(key, { employee, storageDate, flows: [flow] });
    }
  }

  for (const group of flowGroups.values()) {
    const sortedFlows = group.flows
      .slice()
      .sort((a, b) => Number(a.check_time) - Number(b.check_time));

    const firstFlow = sortedFlows[0];
    const lastFlow = sortedFlows.length > 1 ? sortedFlows[sortedFlows.length - 1] : null;
    const flowCheckIn = firstFlow ? flowTime(firstFlow) : null;
    const flowCheckOut = lastFlow ? flowTime(lastFlow) : null;
    const idempKey = attendanceKey(
      group.employee.userId || group.employee.employeeCode || group.employee.id,
      group.storageDate.toISOString().split('T')[0],
    );

    const existing = await prisma.dailyAttendance.findFirst({
      where: {
        OR: [
          { idempotencyKey: idempKey },
          { employeeId: group.employee.id, attendanceDate: group.storageDate },
        ],
      },
    });

    const checkIn = existing?.checkIn ?? flowCheckIn;
    const checkOut = existing?.checkOut ?? flowCheckOut;
    if (!checkIn && !checkOut) continue;

    const workHours = existing?.checkIn && existing?.checkOut
      ? Number(existing.workHours)
      : calcWorkHours(checkIn, checkOut);
    const rawLateHours = calcLateHours(checkIn, null);
    const rawEarlyHours = checkOut ? calcEarlyHours(checkOut, null) : 0;
    const lateHours = roundLateEarlyHours(rawLateHours, lateEarlyRoundingRules);
    const earlyHours = roundLateEarlyHours(rawEarlyHours, lateEarlyRoundingRules);
    const missingHours = checkOut ? Math.round((lateHours + earlyHours) * 100) / 100 : 0;
    const conclusion = checkIn && !checkOut && isActualToday(group.storageDate)
      ? 'Đang làm (chưa check-out)'
      : getConclusion(workHours, checkIn, checkOut);
    const rawData = buildRawDataFromFlows(sortedFlows, checkIn, checkOut);

    const data = {
      attendanceDate: group.storageDate,
      checkIn,
      checkOut,
      workHours,
      rawLateHours,
      rawEarlyHours,
      lateHours,
      earlyHours,
      otHoursPreliminary: 0,
      missingHours,
      conclusion,
      source: 'LARK_SYNC' as const,
      rawData,
      syncedAt: new Date(),
    };

    try {
      if (existing) {
        const shouldUpdate =
          (!existing.checkIn && checkIn) ||
          (!existing.checkOut && checkOut) ||
          existing.conclusion === 'Không chấm công' ||
          existing.conclusion === 'Thiếu check-out';
        if (shouldUpdate) {
          await prisma.dailyAttendance.update({
            where: { id: existing.id },
            data,
          });
          updated++;
        }
      } else {
        await prisma.dailyAttendance.create({
          data: {
            ...data,
            employeeId: group.employee.id,
            idempotencyKey: idempKey,
          },
        });
        created++;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`${MODULE} Error processing raw flow for ${group.employee.userId} on ${group.storageDate.toISOString().slice(0, 10)}:`, msg);
      skipped++;
    }
  }

  console.log(`${MODULE} Done — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
  return { created, updated, skipped };
}
