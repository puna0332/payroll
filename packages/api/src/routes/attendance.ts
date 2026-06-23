/**
 * Attendance Routes — daily attendance data for timesheet grid
 * Frontend gọi endpoint này để hiển thị bảng chấm công hàng ngày
 *
 * Hỗ trợ 2 mode:
 *   - periodId: lấy date range từ lịch chốt công (ưu tiên)
 *   - monthKey: fallback theo calendar month
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../shared/db/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';
import { adjustIfDateOnly, applySubmissionPolicyOverride, calcCorrectionCredit, parseOtApproval } from '../modules/calc/ot-calculator.js';
import { getApprovalSubmissionPolicyConfig } from '../modules/calc/submission-policy-settings.js';
import { normalizeApprovalType } from './approvals.js';
import { belongsToPeriodByJoinDate } from '../shared/utils/employment-period.js';
import { resolveEffectiveOtScheduleType, resolveEffectiveScheduleType } from '../shared/utils/work-schedule.js';

const router = Router();

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

const STAFF_CODE_BY_NAME: Record<string, string> = {
  'Tran': 'ASV002',
  'Tram': 'ASV003',
  'Tai': 'ASV005',
  'Huan': 'ASV008',
  'Nguyễn Văn Cảnh': 'ASV011',
  'Nguyễn Thị Thu Trang': 'ASV014',
  'Lê Ngọc Khánh': 'ASV016',
  'Hà Minh Châu': 'ASV017',
  'Phan Anh Hùng': 'ASV018',
};

/**
 * Helper to parse the actual approved time interval (work/leave) from Lark rawData form widgets
 */
type ApprovalLike = {
  approvalType: string;
  rawData: unknown;
  startTime: Date | null;
  endTime: Date | null;
  approvedHours?: unknown;
  submissionPolicyOverride?: boolean;
};

type ApprovalInterval = { start: Date; end: Date; hours: number };

function formWidgets(rawData: unknown): Array<Record<string, unknown>> {
  if (!rawData || typeof rawData !== 'object') return [];
  const form = (rawData as Record<string, unknown>).form;
  return Array.isArray(form) ? form.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function widgetTextValues(widget: Record<string, unknown>): string[] {
  const values: string[] = [];
  const value = widget.value;

  if (typeof value === 'string') values.push(value);
  if (Array.isArray(value)) values.push(...value.filter((item): item is string => typeof item === 'string'));

  const option = widget.option;
  if (Array.isArray(option)) {
    for (const item of option) {
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        values.push((item as { text: string }).text);
      }
    }
  } else if (option && typeof option === 'object' && typeof (option as { text?: unknown }).text === 'string') {
    values.push((option as { text: string }).text);
  }

  return values;
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

function addDaysToYmd(dateKey: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function isTodayInVn(date: Date): boolean {
  return ymdInVn(date) === ymdInVn(new Date());
}

function isCompLeaveChange(rawData: unknown): boolean {
  const changeTypeWidget = formWidgets(rawData).find((widget) => {
    const name = String(widget.name ?? '');
    return name.includes('変更タイプ') || name.toLowerCase().includes('change');
  });

  return Boolean(changeTypeWidget && widgetTextValues(changeTypeWidget).some((value) => (
    value.includes('休日変更') ||
    value.toLowerCase().includes('comp') ||
    value.toLowerCase().includes('nghỉ bù') ||
    value.toLowerCase().includes('nghi bu')
  )));
}

function isCompLeaveChangeFrame(changeType: string | null | undefined): boolean {
  if (!changeType) return false;
  const normalized = changeType.toLowerCase();
  return (
    changeType.includes('休日変更') ||
    normalized.includes('comp') ||
    normalized.includes('nghỉ bù') ||
    normalized.includes('nghi bu')
  );
}

function isWorkTimeChange(rawData: unknown): boolean {
  const changeTypeWidget = formWidgets(rawData).find((widget) => {
    const name = String(widget.name ?? '');
    return name.includes('変更タイプ') || name.toLowerCase().includes('change');
  });

  return Boolean(changeTypeWidget && widgetTextValues(changeTypeWidget).some((value) => {
    const normalized = value.toLowerCase();
    return (
      value.includes('勤務時間変更') ||
      normalized.includes('shift') ||
      normalized.includes('đổi ca') ||
      normalized.includes('doi ca')
    );
  }));
}

function extractSubmittedAt(rawData: unknown): Date | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;
  const rawStartTime = data.start_time ?? data.startTime;
  if (typeof rawStartTime === 'number' || typeof rawStartTime === 'string') {
    const millis = Number(rawStartTime);
    if (Number.isFinite(millis) && millis > 0) return new Date(millis);
  }

  const timeline = data.timeline;
  if (Array.isArray(timeline)) {
    const startEvent = timeline.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'START') as Record<string, unknown> | undefined;
    const createTime = startEvent?.create_time;
    if (typeof createTime === 'number' || typeof createTime === 'string') {
      const millis = Number(createTime);
      if (Number.isFinite(millis) && millis > 0) return new Date(millis);
    }
  }

  return null;
}

function isLateWorkTimeChange(rawData: unknown, requiredDaysBefore = 1): boolean {
  if (!isWorkTimeChange(rawData)) return false;
  const intervals = parseDateIntervals(rawData);
  const effectiveInterval = intervals.length >= 2 ? intervals[intervals.length - 1] : intervals[0];
  if (!effectiveInterval) return false;

  const submittedAt = extractSubmittedAt(rawData);
  if (!submittedAt) return true;
  return ymdInVn(submittedAt) > addDaysToYmd(ymdInVn(effectiveInterval.start), -requiredDaysBefore);
}

function parseDateIntervals(rawData: unknown): ApprovalInterval[] {
  return formWidgets(rawData)
    .filter((widget) => String(widget.type ?? '').toLowerCase() === 'dateinterval' && widget.value && typeof widget.value === 'object')
    .map((widget) => {
      const value = widget.value as { start?: unknown; end?: unknown; interval?: unknown };
      const rawStart = typeof value.start === 'string' ? new Date(value.start) : null;
      const rawEnd = typeof value.end === 'string' ? new Date(value.end) : null;
      if (!rawStart || !rawEnd || rawStart >= rawEnd) return null;
      const { start, end } = adjustIfDateOnly(rawStart, rawEnd);
      const hours = Number(value.interval ?? 0);
      return { start, end, hours: Number.isFinite(hours) ? hours : 0 };
    })
    .filter((item): item is ApprovalInterval => Boolean(item))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== 'object') return '';

  const obj = value as Record<string, unknown>;
  for (const key of ['text', 'value', 'name']) {
    const text = textFromValue(obj[key]);
    if (text) return text;
  }
  return '';
}

function normalizeYmdText(value: string): string | null {
  const text = value.trim();
  const iso = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const vn = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (vn) {
    const [, day, month, year] = vn;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
}

function parseCorrectionRemedyInterval(ar: ApprovalLike): ApprovalInterval | null {
  if (ar.approvalType !== 'Correction') return null;

  const remedyWidget = formWidgets(ar.rawData).find((widget) => {
    const type = String(widget.type ?? '').toLowerCase();
    const id = String(widget.id ?? '').toLowerCase();
    const customId = String(widget.custom_id ?? '').toLowerCase();
    return type.includes('remedygroup') || id.includes('remedy') || customId.includes('remedy');
  });
  if (!remedyWidget?.value || typeof remedyWidget.value !== 'object') return null;

  const value = remedyWidget.value as Record<string, unknown>;
  const remedyDateText = textFromValue(value.widgetRemedyGroupV2RemedyDate);
  const remedyTimeText = textFromValue(value.widgetRemedyGroupV2RemedyTime);
  const ymd = normalizeYmdText(remedyDateText) ?? normalizeYmdText(remedyTimeText);
  if (!ymd) return null;

  // Correction approvals belong to the attendance date being fixed, not to
  // the workflow submit/approve time. Use the full UTC day to avoid timezone
  // boundary drift when matching against daily attendance rows.
  const start = new Date(`${ymd}T00:00:00.000Z`);
  const end = new Date(`${ymd}T23:59:59.999Z`);
  const hours = Number(String(ar.approvedHours ?? 0));
  return { start, end, hours: Number.isFinite(hours) ? hours : 0 };
}

/**
 * Parse approved intervals that should affect an attendance date.
 * For 休日変更, only compensated leave windows count toward daily attendance;
 * the worked source window is audit context for OT/comp matching.
 */
function getApprovedIntervals(ar: ApprovalLike, requiredDaysBefore = 1): ApprovalInterval[] {
  const rawD = ar.rawData as Record<string, unknown> | null;
  const form = formWidgets(rawD);
  if (form.length === 0) return [];

  // 1. OT / ChangeHours (workGroup widget)
  const workGroupWidget = form.find(
    (f) => (f.type as string) === 'workGroup' || (f.id as string)?.toLowerCase().includes('workgroup'),
  );
  if (workGroupWidget?.value) {
    const wg = workGroupWidget.value as any;
    if (wg.start && wg.end) {
      const start = new Date(wg.start);
      const end = new Date(wg.end);
      return start < end ? [{ start, end, hours: Math.max(0, (end.getTime() - start.getTime()) / 3_600_000) }] : [];
    }
  }

  // 2. Leave / NightShift (leaveGroup widget)
  const leaveWidget = form.find(
    (f) => (f.type as string) === 'leaveGroup' || (f.type as string) === 'leaveGroupV2' || (f.id as string)?.toLowerCase().includes('leavegroup'),
  );
  if (leaveWidget?.value) {
    const lg = leaveWidget.value as any;
    if (lg.startTime && lg.endTime) {
      const start = new Date(lg.startTime);
      const end = new Date(lg.endTime);
      return start < end ? [{ start, end, hours: Math.max(0, (end.getTime() - start.getTime()) / 3_600_000) }] : [];
    }
  }

  // 3. Correction / missing punch remedy date
  const correctionRemedyInterval = parseCorrectionRemedyInterval(ar);
  if (correctionRemedyInterval) {
    return [correctionRemedyInterval];
  }

  // 4. dateInterval widget (ChangeHours / Correction)
  const dateIntervals = parseDateIntervals(rawD);
  if (dateIntervals.length > 0) {
    if (ar.approvalType === 'ChangeHours' && !ar.submissionPolicyOverride && isLateWorkTimeChange(rawD, requiredDaysBefore)) {
      return [];
    }
    return ar.approvalType === 'ChangeHours' && isCompLeaveChange(rawD) && dateIntervals.length >= 2
      ? dateIntervals.slice(1)
      : dateIntervals;
  }

  return ar.startTime && ar.endTime && ar.startTime < ar.endTime
    ? [{ start: ar.startTime, end: ar.endTime, hours: Math.max(0, (ar.endTime.getTime() - ar.startTime.getTime()) / 3_600_000) }]
    : [];
}

function getApprovedIntervalForDay(ar: ApprovalLike, dayStart: Date, dayEnd: Date, requiredDaysBefore = 1): ApprovalInterval | null {
  return getApprovedIntervals(ar, requiredDaysBefore).find((interval) => interval.start <= dayEnd && interval.end >= dayStart) ?? null;
}

/**
 * Convert Prisma Decimal fields to plain numbers for JSON serialization.
 * Uses duck-typing as fallback since instanceof can fail across module boundaries.
 */
function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Decimal) return value.toNumber();
  // Duck-typing: Prisma Decimal has a toNumber() method
  if (typeof value === 'object' && 'toNumber' in value && typeof (value as Record<string, unknown>).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  // String fallback (e.g. "8.58")
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeStaffCode(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const mapped = STAFF_CODE_BY_NAME[value.trim()];
    if (mapped) return mapped;
    const match = value.trim().match(/^ASV0*(\d+)$/i);
    if (!match) continue;
    return `ASV${match[1].padStart(3, '0')}`;
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function overlapHours(startA: Date | null, endA: Date | null, startB: Date | null, endB: Date | null): number {
  if (!startA || !endA || !startB || !endB) return 0;
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return end > start ? (end - start) / 3_600_000 : 0;
}

function effectiveHours(value: number): number {
  const rounded = round2(Math.max(value, 0));
  return rounded < 0.05 ? 0 : rounded;
}

/**
 * GET /api/attendance/daily?periodId=xxx
 * GET /api/attendance/daily?monthKey=202605 (fallback)
 *
 * Ưu tiên periodId — lấy date range từ payroll_periods (lịch chốt công).
 * Fallback monthKey — calendar month range.
 *
 * Returns:
 *   {
 *     employees: [...],
 *     records: [...],
 *     period: { id, monthKey, label, periodStart, periodEnd, status } | null
 *   }
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { periodId, monthKey } = req.query;

    let startDate: Date;
    let endDate: Date;
    let periodInfo: {
      id: string;
      monthKey: string;
      label: string;
      periodStart: string;
      periodEnd: string;
      status: string;
    } | null = null;

    // ── Mode 1: Period-based (lịch chốt công) ─────────────────
    if (periodId && typeof periodId === 'string') {
      const period = await prisma.payrollPeriod.findUnique({
        where: { id: periodId },
      });
      if (!period) {
        return res.status(404).json({ error: 'Period not found' });
      }
      startDate = period.periodStart;
      endDate = endOfUtcDay(period.periodEnd);
      periodInfo = {
        id: period.id,
        monthKey: period.monthKey,
        label: period.label,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        status: period.status,
      };
    }
    // ── Mode 2: monthKey fallback → auto-find matching period ──
    else if (monthKey && typeof monthKey === 'string' && /^\d{6}$/.test(monthKey)) {
      // Try to find period for this monthKey
      const period = await prisma.payrollPeriod.findUnique({
        where: { monthKey: monthKey },
      });

      if (period) {
        // Use period dates (lịch chốt công)
        startDate = period.periodStart;
        endDate = endOfUtcDay(period.periodEnd);
        periodInfo = {
          id: period.id,
          monthKey: period.monthKey,
          label: period.label,
          periodStart: period.periodStart.toISOString(),
          periodEnd: period.periodEnd.toISOString(),
          status: period.status,
        };
      } else {
        // No period found — fallback to calendar month
        const year = parseInt(monthKey.slice(0, 4), 10);
        const month = parseInt(monthKey.slice(4, 6), 10);
        if (month < 1 || month > 12) {
          return res.status(400).json({ error: 'Invalid month in monthKey' });
        }
        startDate = new Date(Date.UTC(year, month - 1, 1));
        endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      }
    } else {
      return res.status(400).json({
        error: 'periodId or monthKey (YYYYMM) is required',
      });
    }

    // ── Lark offset: records stored 1 day earlier than actual work date ──
    const queryStart = new Date(startDate);
    queryStart.setDate(queryStart.getDate() - 1);
    const queryEnd = new Date(endDate);
    queryEnd.setDate(queryEnd.getDate() - 1);

    // ── Parallel queries ───────────────────────────────────────
    const [rawEmployees, records] = await Promise.all([
      prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          position: true,
          department: true,
          employmentType: true,
          scheduleType: true,
          joinDate: true,
          larkMetadata: true,
        },
        orderBy: { fullName: 'asc' },
      }),
      prisma.dailyAttendance.findMany({
        where: {
          attendanceDate: {
            gte: queryStart,
            lte: queryEnd,
          },
        },
        orderBy: [{ employeeId: 'asc' }, { attendanceDate: 'asc' }],
      }),
    ]);

    // ── Query approval records for the period ─────────────────
    // Lấy tất cả approved approvals trong kỳ để map vào từng ngày
    const approvalRecords = await prisma.approvalRecord.findMany({
      where: {
        status: 'APPROVED',
        OR: [
          { startTime: { gte: startDate, lte: endDate } },
          { endTime:   { gte: startDate, lte: endDate } },
          { startTime: { lte: startDate }, endTime: { gte: endDate } },
        ],
      },
      select: {
        id: true,
        instanceCode: true,
        serialNumber: true,
        approvalType: true,
        leaveType: true,
        leaveTypeBucket: true,
        status: true,
        approvedHours: true,
        approvedDays: true,
        startTime: true,
        endTime: true,
        employeeId: true,
        submissionPolicyOverride: true,
        rawData: true,
      },
    });

    // Index approvals by employeeId for O(1) lookup
    const approvalsByEmployee = new Map<string, typeof approvalRecords>();
    for (const ar of approvalRecords) {
      ar.approvalType = normalizeApprovalType(ar.approvalType);
      if (!approvalsByEmployee.has(ar.employeeId)) {
        approvalsByEmployee.set(ar.employeeId, []);
      }
      approvalsByEmployee.get(ar.employeeId)!.push(ar);
    }
    const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);
    const changeHoursRequiredDaysBefore = submissionPolicyConfig.requiredDaysBefore;
    // ── Extract avatarUrl from larkMetadata ──────────────────────
    const eligibleEmployees = rawEmployees.filter((employee) => belongsToPeriodByJoinDate(endDate, employee.joinDate));
    const eligibleEmployeeIds = new Set(eligibleEmployees.map((employee) => employee.id));
    const employeeScheduleById = new Map(eligibleEmployees.map((employee) => [employee.id, resolveEffectiveOtScheduleType(employee)]));
    const employees = eligibleEmployees.map((e) => {
      const meta = e.larkMetadata as Record<string, unknown> | null;
      const employeeCode = normalizeStaffCode(e.employeeCode, meta?.employeeNo, e.fullName);
      return {
        id: e.id,
        fullName: e.fullName,
        employeeCode,
        position: e.position,
        department: e.department,
        employmentType: e.employmentType,
        scheduleType: resolveEffectiveScheduleType(e),
        joinDate: e.joinDate,
        avatarUrl: (meta?.avatarUrl as string) || null,
      };
    });

    // ── Convert Decimal → Number for JSON ──────────────────────
    const serializedRecords = records.filter((r) => eligibleEmployeeIds.has(r.employeeId)).map((r) => {
      // Extract location info from Lark raw data
      const raw = r.rawData as Record<string, unknown> | null;
      const rec0 = (raw?.records as unknown[])?.[0] as Record<string, unknown> | undefined;
      const checkInRec = rec0?.check_in_record as Record<string, unknown> | undefined;
      const checkOutRec = rec0?.check_out_record as Record<string, unknown> | undefined;

      // Parse shift times from raw data (Unix timestamps → ISO)
      // Filter out invalid timestamps (0, empty, or before 2020)
      const MIN_VALID_TS = 1577836800; // 2020-01-01 UTC
      const shiftCheckInTs = rec0?.check_in_shift_time as string | undefined;
      const shiftCheckOutTs = rec0?.check_out_shift_time as string | undefined;
      const parsedShiftIn = shiftCheckInTs ? parseInt(shiftCheckInTs) : 0;
      const parsedShiftOut = shiftCheckOutTs ? parseInt(shiftCheckOutTs) : 0;

      // Lark's attendance date is the shift assignment date (UTC-based).
      // Actual work happens the next calendar day in VN timezone (GMT+7).
      // Shift by +1 day to align with actual work dates.
      const correctedDate = new Date(r.attendanceDate);
      correctedDate.setDate(correctedDate.getDate() + 1);

      // ── OT parsing from rawData ──
      const otData = correctedDate ? (() => {
        // Will be computed per-approval at the end
        return null;
      })() : null;

      // ── Find approvals for this employee on this date ──
      const empApprovals = approvalsByEmployee.get(r.employeeId) ?? [];
      const dayStart = correctedDate;
      const dayEnd = new Date(correctedDate.getTime() + 86399999); // end of day

      const dayApprovals = empApprovals
        .filter(ar => {
          return Boolean(getApprovedIntervalForDay(ar, dayStart, dayEnd, changeHoursRequiredDaysBefore));
        })
        .map(ar => {
          const rawD = ar.rawData as Record<string, unknown> | null;
          const interval = getApprovedIntervalForDay(ar, dayStart, dayEnd, changeHoursRequiredDaysBefore)!;

          // For OT/ChangeHours/NightShift: parse bucket breakdown + changeWorkingFrame
          let otParsed = null;
          if (ar.approvalType === 'OT' || ar.approvalType === 'NightShift' || ar.approvalType === 'ChangeHours') {
            if (rawD) {
              otParsed = applySubmissionPolicyOverride(parseOtApproval(
                rawD,
                r.checkIn,
                r.checkOut,
                employeeScheduleById.get(r.employeeId) ?? 'office',
                ar.approvalType,
                submissionPolicyConfig,
              ), ar.submissionPolicyOverride);
            }
          }

          let changeWorkingFrame = otParsed?.changeWorkingFrame ?? null;
          if (ar.approvalType === 'ChangeHours' && changeWorkingFrame && isCompLeaveChangeFrame(changeWorkingFrame.changeType)) {
            changeWorkingFrame = {
              ...changeWorkingFrame,
              shiftStart: interval.start,
              shiftEnd: interval.end,
              compLeaveHours: Math.min(toNumber(interval.hours), 8),
            };
          }

          return {
            id: ar.id,
            instanceCode: ar.instanceCode,
            serialNumber: ar.serialNumber,
            approvalType: ar.approvalType,
            leaveType: ar.leaveType,
            leaveTypeBucket: ar.leaveTypeBucket,
            status: ar.status,
            approvedHours: Number(ar.approvedHours),
            approvedDays: Number(ar.approvedDays),
            startTime: interval.start,
            endTime: interval.end,
            otBuckets: otParsed?.buckets ?? null,
            validOtHours: otParsed?.validTotalHours ?? null,
            otPolicy: otParsed?.otPolicy ?? null,
            isNightShift: otParsed?.isNightShift ?? false,
            changeWorkingFrame,
            rawData: ar.rawData,
          };
        });

      // ── Correction credit calculation ──
      const correctionApprovals = dayApprovals.filter(a => a.approvalType === 'Correction');
      const totalCorrectionHours = correctionApprovals.reduce((s, a) => s + a.approvedHours, 0);
      const lateH = toNumber(r.lateHours);
      const earlyH = toNumber(r.earlyHours);

      const correctionCredit = totalCorrectionHours > 0
        ? calcCorrectionCredit(totalCorrectionHours, lateH, earlyH)
        : null;

      // ── Calculate dynamic conclusion based on actual hours + leaves + corrections ──
      let stdHours = 8;
      if (parsedShiftIn > MIN_VALID_TS && parsedShiftOut > MIN_VALID_TS && parsedShiftIn !== parsedShiftOut) {
        const inDate = new Date(parsedShiftIn * 1000);
        const outDate = new Date(parsedShiftOut * 1000);
        const diffH = (outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60);
        if (inDate.getHours() < 12 && outDate.getHours() >= 13) {
          stdHours = Math.max(0, diffH - 1);
        } else {
          stdHours = Math.max(0, diffH);
        }
      }

      const paidLeaveBuckets = ['ANNUAL', 'BENEFIT', 'COMP_LEAVE', 'REMOTE', 'CORRECTION'];
      const leaveHours = dayApprovals
        .filter(a => paidLeaveBuckets.includes(a.leaveTypeBucket ?? ''))
        .reduce((sum, a) => sum + (a.approvedHours ?? 0), 0);
      const compLeaveHours = dayApprovals
        .filter(a => a.approvalType === 'ChangeHours' && a.status === 'APPROVED')
        .reduce((sum, a) => sum + (a.changeWorkingFrame?.compLeaveHours ?? 0), 0);
      const shiftStartDate = parsedShiftIn > MIN_VALID_TS ? new Date(parsedShiftIn * 1000) : null;
      const shiftEndDate = parsedShiftOut > MIN_VALID_TS && parsedShiftIn !== parsedShiftOut ? new Date(parsedShiftOut * 1000) : null;
      const paidEdgeLeaveApps = dayApprovals.filter(a => (
        a.approvalType === 'Leave' &&
        a.status === 'APPROVED' &&
        paidLeaveBuckets.includes(a.leaveTypeBucket ?? '') &&
        a.leaveTypeBucket !== 'UNPAID'
      ));
      const leaveLateOffset = paidEdgeLeaveApps.reduce((sum, a) => (
        sum + overlapHours(
          a.startTime ? new Date(a.startTime) : null,
          a.endTime ? new Date(a.endTime) : null,
          shiftStartDate,
          r.checkIn,
        )
      ), 0);
      const leaveEarlyOffset = paidEdgeLeaveApps.reduce((sum, a) => (
        sum + overlapHours(
          a.startTime ? new Date(a.startTime) : null,
          a.endTime ? new Date(a.endTime) : null,
          r.checkOut,
          shiftEndDate,
        )
      ), 0);

      const correctionCreditHours = correctionCredit?.workCreditHours ?? 0;
      const totalEffectiveHours = toNumber(r.workHours) + correctionCreditHours + leaveHours + compLeaveHours;
      const effectiveLateHours = effectiveHours((correctionCredit?.effectiveLateHours ?? lateH) - leaveLateOffset);
      const effectiveEarlyHours = effectiveHours((correctionCredit?.effectiveEarlyHours ?? earlyH) - leaveEarlyOffset);

      let effectiveConclusion = r.conclusion || 'Không xác định';

      if (r.checkIn && r.checkOut) {
        if (totalEffectiveHours >= stdHours) {
          effectiveConclusion = 'Đủ công';
        } else {
          effectiveConclusion = 'Thiếu công';
        }
      } else if (!r.checkIn && !r.checkOut) {
        if (compLeaveHours > 0) {
          effectiveConclusion = 'Đủ công (nghỉ bù)';
        } else if (leaveHours >= stdHours) {
          const firstLeave = dayApprovals.find(a => a.approvalType === 'Leave');
          effectiveConclusion = firstLeave?.leaveType || 'Nghỉ phép';
        } else if (totalEffectiveHours >= stdHours) {
          effectiveConclusion = 'Đủ công';
        } else {
          effectiveConclusion = 'Không chấm công';
        }
      } else if (!r.checkIn) {
        effectiveConclusion = 'Thiếu check-in';
      } else {
        effectiveConclusion = isTodayInVn(correctedDate)
          ? 'Đang làm (chưa check-out)'
          : 'Thiếu check-out';
      }

      return {
        id: r.id,
        employeeId: r.employeeId,
        attendanceDate: correctedDate,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        workHours: toNumber(r.workHours),
        lateHours: lateH,
        earlyHours: earlyH,
        otHoursPreliminary: toNumber(r.otHoursPreliminary),
        missingHours: toNumber(r.missingHours),
        conclusion: effectiveConclusion,
        // Location & result info for tooltip
        checkInLocation: (checkInRec?.location_name as string) || null,
        checkOutLocation: (checkOutRec?.location_name as string) || null,
        checkInWifi: (checkInRec?.ssid as string) || null,
        checkInIsWifi: (checkInRec?.is_wifi as boolean) || false,
        checkInIsField: (checkInRec?.is_field as boolean) || false,
        checkInResult: (rec0?.check_in_result as string) || null,
        checkOutResult: (rec0?.check_out_result as string) || null,
        checkInSupplement: (rec0?.check_in_result_supplement as string) || null,
        checkOutSupplement: (rec0?.check_out_result_supplement as string) || null,
        // Shift schedule info
        shiftId: (raw?.shift_id as string) || null,
        groupId: (raw?.group_id as string) || null,
        shiftCheckIn: parsedShiftIn > MIN_VALID_TS ? new Date(parsedShiftIn * 1000).toISOString() : null,
        shiftCheckOut: parsedShiftOut > MIN_VALID_TS && parsedShiftIn !== parsedShiftOut ? new Date(parsedShiftOut * 1000).toISOString() : null,
        // Approvals linked to this day
        approvals: dayApprovals,
        // Correction credit (runtime calculation, doesn't modify DB)
        correctionCredit,
        effectiveLateHours,
        effectiveEarlyHours,
      };
    });

    return res.json({
      employees,
      records: serializedRecords,
      period: periodInfo,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Attendance] Daily error:', msg);
    return res.status(500).json({ error: msg });
  }
});

export default router;
