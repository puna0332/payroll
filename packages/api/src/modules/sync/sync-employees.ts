/**
 * Sync Service — Inbound Employee sync từ Lark Admin
 * Đồng bộ danh sách nhân sự từ Lark Base → PostgreSQL
 */

import { PrismaClient, ScheduleType, EmploymentType, EmployeeStatus } from '@prisma/client';
import type { LarkBaseClient } from '../../shared/lark/base.js';
import { TABLE_IDS } from '../../shared/lark/config.js';

const MODULE = '[Sync:Employee]';

// Mapping Lark field names → internal fields
const SCHEDULE_MAP: Record<string, ScheduleType> = {
  'Hành chính': 'OFFICE',
  'Office': 'OFFICE',
  '6 ngày': 'SIX_DAY',
  'SIX_DAY': 'SIX_DAY',
};

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  'Chính thức': 'FT',
  'Full-time': 'FT',
  'Bán thời gian': 'PT',
  'Part-time': 'PT',
  'Thử việc': 'P',
  'Probation': 'P',
  'Quản lý': 'M',
  'Management': 'M',
};

function normalizeAsvCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^ASV\d+$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

interface LarkEmployeeFields {
  'Họ và tên'?: string;
  'Phòng ban'?: string;
  'Chức vụ'?: string;
  'Lịch làm việc'?: string;
  'Hình thức'?: string;
  'Ngày vào'?: number;
  'Ngày nghỉ'?: number;
  'Trạng thái'?: string;
  'Email'?: string;
  'SĐT'?: string;
  'User ID'?: string;
  'Open ID'?: string;
  'Union ID'?: string;
  [key: string]: unknown;
}

export async function syncEmployeesFromLark(
  prisma: PrismaClient,
  larkBase: LarkBaseClient,
): Promise<{ created: number; updated: number; total: number }> {
  console.log(`${MODULE} Starting employee sync...`);

  const records = await larkBase.listAllRecords(TABLE_IDS.HR);
  console.log(`${MODULE} Fetched ${records.length} records from Lark Base`);

  let created = 0;
  let updated = 0;

  for (const record of records) {
    const fields = record.fields as unknown as LarkEmployeeFields;
    const userId = fields['User ID'];
    if (!userId) {
      console.warn(`${MODULE} Skipping record ${record.record_id} — no User ID`);
      continue;
    }

    const department = fields['Phòng ban'] ?? 'Chưa phân bổ';
    const isBod = department.toUpperCase() === 'BOD';
    const data = {
      fullName: fields['Họ và tên'] ?? 'N/A',
      department,
      position: fields['Chức vụ'] ?? (isBod ? 'BOD' : 'N/A'),
      scheduleType: SCHEDULE_MAP[fields['Lịch làm việc'] ?? ''] ?? 'OFFICE' as ScheduleType,
      employmentType: (isBod ? 'M' : EMPLOYMENT_MAP[fields['Hình thức'] ?? ''] ?? 'FT') as EmploymentType,
      joinDate: fields['Ngày vào'] ? new Date(fields['Ngày vào'] as number) : null,
      leaveDate: fields['Ngày nghỉ'] ? new Date(fields['Ngày nghỉ'] as number) : null,
      status: (fields['Trạng thái'] === 'Nghỉ việc' ? 'INACTIVE' : 'ACTIVE') as EmployeeStatus,
      email: fields['Email'] ?? null,
      mobile: fields['SĐT'] ?? null,
      openId: fields['Open ID'] ?? null,
      unionId: fields['Union ID'] ?? null,
      employeeCode: normalizeAsvCode(fields['Mã số NV']) ?? normalizeAsvCode(userId),
      larkRecordId: record.record_id,
      larkMetadata: fields as object,
    };

    const existing = await prisma.employee.findUnique({
      where: { userId: userId as string },
    });

    if (existing) {
      await prisma.employee.update({
        where: { userId: userId as string },
        data,
      });
      updated++;
    } else {
      await prisma.employee.create({
        data: { userId: userId as string, ...data },
      });
      created++;
    }
  }

  console.log(`${MODULE} Done — created: ${created}, updated: ${updated}, total: ${records.length}`);
  return { created, updated, total: records.length };
}
