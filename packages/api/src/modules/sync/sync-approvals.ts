/**
 * Sync Service — Inbound Approval sync từ Lark
 * Đồng bộ phiếu phê duyệt (nghỉ phép, OT, chỉnh sửa giờ) → PostgreSQL
 */

import { PrismaClient, LeaveTypeBucket, ApprovalStatus } from '@prisma/client';
import type { LarkApprovalClient } from '../../shared/lark/approval.js';
import { prisma as defaultPrisma } from '../../shared/db/prisma.js';
import { approvalKey } from '../../shared/utils/idempotency.js';

const MODULE = '[Sync:Approval]';

// Mapping approval_code → loại phiếu (sẽ config trong env hoặc constants)
export const APPROVAL_CODES = {
  LEAVE: '42AF3FF2-6099-4CEA-9097-4C10A6B552A2',         // Nghỉ phép (phép năm, không lương, chế độ)
  OT: 'F1586D34-4E5D-4CF8-91F6-6A4DF4EFCE95',            // Đăng ký OT
  CHANGE_HOURS: 'E4423CE6-05E7-488A-B565-9868EA871558',  // Thay đổi giờ làm việc
  CORRECTION: 'AF040119-D6CA-4E5D-BC87-F86851B62124',    // Bổ sung chấm công
  NIGHT_SHIFT: '3DA18859-B612-4D76-AC79-4341FDD31914',   // Đăng ký làm ca đêm
} as const;

// Mapping loại nghỉ phép → bucket
// ─── ANNUAL (Phép năm 有休) ───────────────────────────────────────
// ─── BENEFIT (Nghỉ có lương: phúc lợi, sinh nhật, sinh con, ...) ─
// ─── UNPAID  (Nghỉ trừ lương: không lương, ốm, BHXH) ────────────
// ─── COMP_LEAVE (Nghỉ bù) ────────────────────────────────────────
const LEAVE_BUCKET_MAP: Record<string, LeaveTypeBucket> = {
  // ── ANNUAL ──
  'Nghỉ phép năm':                  'ANNUAL',
  'Annual Leave':                    'ANNUAL',
  '有休':                            'ANNUAL',   // Lark Japanese label
  'Phép năm':                        'ANNUAL',
  'Phep nam':                        'ANNUAL',

  // ── BENEFIT (Nghỉ có lương — hưởng lương) ──
  'Nghỉ hưởng lương khác':           'BENEFIT',
  'Nghỉ phúc lợi':                   'BENEFIT',
  'Sinh nhật':                       'BENEFIT',
  '誕生日休暇':                       'BENEFIT',  // Birthday leave (Japanese)
  'Sinh con':                        'BENEFIT',
  'Kết hôn':                         'BENEFIT',
  'Nghỉ khám thai':                   'BENEFIT',
  'Nghỉ thai sản':                   'BENEFIT',
  'Nghỉ chế độ':                     'BENEFIT',
  'Benefit Leave':                   'BENEFIT',
  'Paid Leave':                      'BENEFIT',
  'Special Leave':                   'BENEFIT',

  // ── UNPAID (Nghỉ trừ lương — không hưởng lương) ──
  'Nghỉ không hưởng lương':          'UNPAID',
  'Nghỉ không hưởng lương khác':     'UNPAID',
  'Nghỉ không lương':                'UNPAID',
  'Nghỉ ốm':                         'UNPAID',
  'Nghỉ ốm/bệnh':                    'UNPAID',
  'Nghỉ ốm/bệnh hưởng BHXH(<15y)':   'UNPAID',
  'Nghỉ ốm/bệnh hưởng BHXH(≥15y)':   'UNPAID',
  'Nghỉ bệnh':                       'UNPAID',
  'Nghỉ BHXH':                       'UNPAID',
  'BHXH':                            'UNPAID',
  'Sick Leave':                      'UNPAID',
  'Unpaid Leave':                    'UNPAID',
  '欠勤':                            'UNPAID',   // Absence (Japanese)

  // ── COMP_LEAVE (Nghỉ bù) ──
  'Nghỉ bù':                         'COMP_LEAVE',
  'Compensatory Leave':              'COMP_LEAVE',
  'Bù phép':                         'COMP_LEAVE',

  // ── REMOTE (không tính vào chấm công) ──
  'Làm việc từ xa':                  'REMOTE',
  'Remote Work':                     'REMOTE',
  'WFH':                             'REMOTE',
};

// Mapping Lark approval status → internal
const STATUS_MAP: Record<string, ApprovalStatus> = {
  'APPROVED': 'APPROVED',
  'REJECTED': 'REJECTED',
  'PENDING': 'PENDING',
  'CANCELED': 'CANCELLED',
  'REVERTED': 'CANCELLED',
};

export interface SyncApprovalOptions {
  startTime: number;  // Unix timestamp (ms)
  endTime: number;    // Unix timestamp (ms)
  approvalCodes?: string[]; // Specific approval codes to sync
}

export async function syncApprovalsFromLark(
  larkApproval: LarkApprovalClient,
  options: SyncApprovalOptions,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ created: number; updated: number; skipped: number }> {
  console.log(`${MODULE} Syncing approvals: ${new Date(options.startTime).toISOString()} → ${new Date(options.endTime).toISOString()}`);

  // Lấy all approval codes to sync
  const codesToSync = options.approvalCodes?.length
    ? options.approvalCodes
    : Object.values(APPROVAL_CODES).filter(Boolean);

  if (codesToSync.length === 0) {
    console.warn(`${MODULE} No approval codes configured — skipping`);
    return { created: 0, updated: 0, skipped: 0 };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Lấy employee map (userId/openId/employeeCode → employee)
  const employees = await prisma.employee.findMany({
    select: { id: true, userId: true, openId: true, employeeCode: true },
  });
  const empByUserId = new Map(employees.map(e => [e.userId, e]));
  const empByOpenId = new Map(
    employees.filter(e => e.openId).map(e => [e.openId!, e]),
  );
  const empByEmployeeCode = new Map(
    employees.filter(e => e.employeeCode).map(e => [e.employeeCode!, e]),
  );

  for (const approvalCode of codesToSync) {
    console.log(`${MODULE} Syncing approval code: ${approvalCode}`);

    // Lấy danh sách instance codes — Lark API expects milliseconds
    const instanceCodes = await larkApproval.listInstances(
      approvalCode,
      options.startTime,
      options.endTime,
    );

    console.log(`${MODULE} Found ${instanceCodes.length} instances for ${approvalCode}`);

    for (const instanceCode of instanceCodes) {
      try {
        // Check existing
        const existing = await prisma.approvalRecord.findUnique({
          where: { instanceCode },
          select: { id: true, status: true },
        });

        // Lấy chi tiết instance
        const instance = await larkApproval.getInstance(instanceCode);

        // Tìm employee
        const employee =
          empByUserId.get(instance.user_id ?? '') ??
          empByOpenId.get(instance.open_id ?? '') ??
          empByEmployeeCode.get(instance.user_id ?? '');

        if (!employee) {
          console.warn(`${MODULE} Skipping ${instanceCode} — employee not found (user_id: ${instance.user_id})`);
          skipped++;
          continue;
        }

        // Parse form values for leave type, hours, days
        const formValues = parseFormValues(instance.form ?? []);
        // Approval type is determined by the definition code (authoritative)
        const approvalType = getApprovalTypeFromCode(approvalCode);
        const leaveType = formValues.leaveType || null;
        const leaveTypeBucket = leaveType ? (LEAVE_BUCKET_MAP[leaveType] ?? null) : null;

        // Lark instance timestamps are the submit/approval timeline. For payroll
        // period matching we store the actual form range (OT/leave/change time)
        // in startTime/endTime and keep the submit time in applyDate.
        const submittedStartMs = parseInt(String(instance.start_time), 10);
        const submittedEndMs = parseInt(String(instance.end_time), 10);
        const actualStart = formValues.startTime ?? (submittedStartMs ? new Date(submittedStartMs) : null);
        const actualEnd = formValues.endTime ?? ((submittedEndMs && submittedEndMs > 0) ? new Date(submittedEndMs) : actualStart);

        const data = {
          approvalCode,
          serialNumber: instance.serial_number ?? null,
          approvalType,
          leaveType,
          leaveTypeBucket,
          status: STATUS_MAP[instance.status ?? ''] ?? 'PENDING' as ApprovalStatus,
          applyDate: submittedStartMs ? new Date(submittedStartMs) : null,
          approvedHours: formValues.hours ?? 0,
          approvedDays: formValues.days ?? 0,
          startTime: actualStart,
          endTime: actualEnd,
          larkRecordId: null as string | null,
          rawData: instance as object,
          syncedAt: new Date(),
        };

        if (existing) {
          await prisma.approvalRecord.update({
            where: { instanceCode },
            data,
          });
          updated++;
        } else {
          await prisma.approvalRecord.create({
            data: {
              ...data,
              employeeId: employee.id,
              instanceCode,
            },
          });
          created++;
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`${MODULE} Error processing instance ${instanceCode}:`, msg);
        skipped++;
      }
    }
  }

  console.log(`${MODULE} Done — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
  return { created, updated, skipped };
}

// Mapping approval_code → approvalType (set by caller based on group)
const CODE_GROUP_MAP: Record<string, string> = {
  '42AF3FF2-6099-4CEA-9097-4C10A6B552A2': 'Leave',
  'F1586D34-4E5D-4CF8-91F6-6A4DF4EFCE95': 'OT',
  'AF040119-D6CA-4E5D-BC87-F86851B62124': 'Correction',
  '3DA18859-B612-4D76-AC79-4341FDD31914': 'NightShift',
  'E4423CE6-05E7-488A-B565-9868EA871558': 'ChangeHours',
};

/**
 * Derive approvalType from the approval definition code
 */
function getApprovalTypeFromCode(code: string): string {
  return CODE_GROUP_MAP[code] || 'Unknown';
}

/**
 * Parse Lark approval form values
 * Form can be a JSON string or already-parsed array
 */
function parseFormValues(form: unknown): {
  approvalType: string;
  leaveType: string | null;
  hours: number;
  days: number;
  startTime: Date | null;
  endTime: Date | null;
} {
  try {
    let widgets: any[];
    if (typeof form === 'string') {
      widgets = JSON.parse(form);
    } else if (Array.isArray(form)) {
      widgets = form;
    } else {
      return { approvalType: 'Unknown', leaveType: null, hours: 0, days: 0, startTime: null, endTime: null };
    }

    let approvalType = 'Unknown';
    let leaveType: string | null = null;
    let hours = 0;
    let days = 0;
    let startTime: Date | null = null;
    let endTime: Date | null = null;

    for (const widget of widgets) {
      const customId = (widget.custom_id || widget.id || '').toLowerCase();
      const widgetType = (widget.type || '').toLowerCase();
      const value = widget.value;

      // ── Lark native leave widget (leaveGroup / leaveGroupV2) ──
      if (widgetType === 'leavegroup' || widgetType === 'leavegroupv2' || widgetType === 'widgetleavegroupv2') {
        approvalType = 'Leave';
        if (typeof value === 'object' && value) {
          leaveType = value.name || null;
          const range = extractFormRange(value);
          startTime ??= range.start;
          endTime ??= range.end;
          if (value.interval != null) {
            const unit = value.unit || 'DAY';
            if (unit === 'HOUR') {
              hours = parseFloat(value.interval) || 0;
            } else {
              days = parseFloat(value.interval) || 0;
            }
          }
        }
        continue;
      }

      // ── Lark native work widget (workGroup) ──
      if (widgetType === 'workgroup') {
        approvalType = 'ChangeHours';
        if (typeof value === 'object' && value && value.interval != null) {
          hours = parseFloat(value.interval) || 0;
        }
        if (typeof value === 'object' && value) {
          const range = extractFormRange(value);
          startTime ??= range.start;
          endTime ??= range.end;
        }
        continue;
      }

      // ── Lark native remedy widget (remedyGroup / remedyGroupV2) ──
      if (widgetType === 'remedygroup' || widgetType === 'remedygroupv2' || customId.includes('remedy')) {
        approvalType = 'Correction';
        if (typeof value === 'object' && value) {
          const range = extractFormRange(value);
          startTime ??= range.start;
          endTime ??= range.end;
        }
        continue;
      }

      // ── dateInterval widget ──
      if (widgetType === 'dateinterval' && typeof value === 'object' && value) {
        const range = extractFormRange(value);
        startTime ??= range.start;
        endTime ??= range.end;
        if (value.interval != null) {
          days = parseFloat(value.interval) || 0;
        }
        continue;
      }

      // ── Fallback: match by custom_id patterns ──
      if (customId.includes('leave_type') || customId.includes('loai_nghi')) {
        leaveType = typeof value === 'string' ? value : value?.text ?? null;
        approvalType = 'Leave';
      }

      if (customId.includes('hours') || customId.includes('gio') || customId.includes('so_gio')) {
        hours = parseFloat(value) || 0;
      }

      if (customId.includes('days') || customId.includes('ngay') || customId.includes('so_ngay')) {
        days = parseFloat(value) || 0;
      }

      if (customId.includes('ot') || customId.includes('overtime')) {
        approvalType = 'OT';
      }

      if (customId.includes('correction') || customId.includes('bo_sung')) {
        approvalType = 'Correction';
      }

      if (customId.includes('change') || customId.includes('thay_doi')) {
        approvalType = 'ChangeHours';
      }
    }

    return { approvalType, leaveType, hours, days, startTime, endTime };
  } catch {
    return { approvalType: 'Unknown', leaveType: null, hours: 0, days: 0, startTime: null, endTime: null };
  }
}

function textFromFormValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== 'object') return '';

  const obj = value as Record<string, unknown>;
  for (const key of ['text', 'value', 'name']) {
    const text = textFromFormValue(obj[key]);
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

function parseLarkDateField(value: unknown): Date | null {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return parseFormDate(obj.value) ?? parseFormDate(obj.text);
  }
  return parseFormDate(value);
}

function parseFormDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && value.trim().length >= 10
      ? new Date(numeric)
      : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function extractFormRange(value: Record<string, unknown>): { start: Date | null; end: Date | null } {
  const remedyTime = parseLarkDateField(value.widgetRemedyGroupV2RemedyTime);
  if (remedyTime) {
    return { start: remedyTime, end: remedyTime };
  }

  const remedyDateYmd = normalizeYmdText(textFromFormValue(value.widgetRemedyGroupV2RemedyDate));
  if (remedyDateYmd) {
    const remedyDate = new Date(`${remedyDateYmd}T00:00:00.000Z`);
    return { start: remedyDate, end: remedyDate };
  }

  const ranges = Array.isArray(value.timeRange)
    ? value.timeRange
    : Array.isArray(value.dateRange)
      ? value.dateRange
      : [];
  const firstRange = ranges.find((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  const start = parseFormDate(
    firstRange?.start
    ?? firstRange?.startTime
    ?? value.start
    ?? value.startTime
    ?? value.begin
    ?? value.beginTime,
  );
  const end = parseFormDate(
    firstRange?.end
    ?? firstRange?.endTime
    ?? value.end
    ?? value.endTime
    ?? value.finish
    ?? value.finishTime,
  );
  return { start, end };
}

/**
 * Sync Pending Approvals — Synchronizes only approvals with a PENDING status in the DB
 * to fetch their latest status (APPROVED, REJECTED, CANCELLED) and save resources.
 */
export async function syncPendingApprovalsFromLark(
  larkApproval: LarkApprovalClient,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ updated: number; skipped: number; total: number }> {
  console.log(`${MODULE} Starting sync of pending approvals...`);

  // 1. Query all PENDING approvals in the database
  const pendingRecords = await prisma.approvalRecord.findMany({
    where: { status: 'PENDING' },
    select: { id: true, instanceCode: true, approvalCode: true },
  });

  console.log(`${MODULE} Found ${pendingRecords.length} pending approvals in database.`);

  let updated = 0;
  let skipped = 0;

  if (pendingRecords.length === 0) {
    return { updated: 0, skipped: 0, total: 0 };
  }

  // 2. Load employees map
  const employees = await prisma.employee.findMany({
    select: { id: true, userId: true, openId: true },
  });
  const empByUserId = new Map(employees.map(e => [e.userId, e]));
  const empByOpenId = new Map(
    employees.filter(e => e.openId).map(e => [e.openId!, e]),
  );

  for (const record of pendingRecords) {
    try {
      // 3. Fetch latest instance detail from Lark
      const instance = await larkApproval.getInstance(record.instanceCode);
      const newStatus = STATUS_MAP[instance.status ?? ''] ?? 'PENDING';

      // 4. Parse form values
      const formValues = parseFormValues(instance.form ?? []);
      const approvalType = getApprovalTypeFromCode(record.approvalCode ?? '');
      const leaveType = formValues.leaveType || null;
      const leaveTypeBucket = leaveType ? (LEAVE_BUCKET_MAP[leaveType] ?? null) : null;

      const submittedStartMs = parseInt(String(instance.start_time), 10);
      const submittedEndMs = parseInt(String(instance.end_time), 10);
      const actualStart = formValues.startTime ?? (submittedStartMs ? new Date(submittedStartMs) : null);
      const actualEnd = formValues.endTime ?? ((submittedEndMs && submittedEndMs > 0) ? new Date(submittedEndMs) : actualStart);

      const data = {
        serialNumber: instance.serial_number ?? null,
        approvalType,
        leaveType,
        leaveTypeBucket,
        status: newStatus as ApprovalStatus,
        applyDate: submittedStartMs ? new Date(submittedStartMs) : null,
        approvedHours: formValues.hours ?? 0,
        approvedDays: formValues.days ?? 0,
        startTime: actualStart,
        endTime: actualEnd,
        rawData: instance as object,
        syncedAt: new Date(),
      };

      // 5. Update database
      await prisma.approvalRecord.update({
        where: { id: record.id },
        data,
      });

      console.log(`${MODULE} Updated pending approval ${record.instanceCode} status to ${newStatus}`);
      updated++;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`${MODULE} Error syncing pending instance ${record.instanceCode}:`, msg);
      skipped++;
    }
  }

  console.log(`${MODULE} Done pending sync — updated: ${updated}, skipped: ${skipped}`);
  return { updated, skipped, total: pendingRecords.length };
}
