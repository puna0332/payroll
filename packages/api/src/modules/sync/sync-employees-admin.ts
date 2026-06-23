/**
 * Sync Service — Inbound Employee sync từ Lark Admin Contacts API
 * Fetch departments + users → upsert vào PostgreSQL
 * 
 * Khác với sync-employees.ts (dùng Lark Base) — đây dùng trực tiếp Contacts v3 API
 */

import type { PrismaClient } from '@prisma/client';
import type { LarkAdminClient, LarkDepartment, LarkUser } from '../../shared/lark/admin.js';

const MODULE = '[Sync:AdminEmployee]';

// ─── Types ──────────────────────────────────────────────────

export interface SyncResult {
  departments: { created: number; updated: number; total: number };
  employees: { created: number; updated: number; deactivated: number; total: number };
  syncedAt: string;
  durationMs: number;
}

// ─── Employee Type Mapping ──────────────────────────────────

const EMPLOYEE_TYPE_MAP: Record<number, string> = {
  1: 'FT',    // Regular → Full-time
  2: 'P',     // Intern → Probation
  3: 'FT',    // Outsource → Full-time (mapped)
  4: 'FT',    // Contractor
  5: 'FT',    // Consultant
};

function normalizeAsvCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^ASV\d+$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

// ─── Main Sync Function ────────────────────────────────────

/**
 * Đồng bộ nhân sự từ Lark Admin Contacts API về database
 * 
 * Flow:
 * 1. Fetch all departments (recursive)
 * 2. Fetch all users across departments (deduped)
 * 3. Upsert departments vào bảng departments (nếu có)
 * 4. Upsert employees vào bảng employees
 * 5. Deactivate employees đã nghỉ
 * 6. Return result summary
 */
export async function syncEmployeesFromAdmin(
  prisma: PrismaClient,
  adminClient: LarkAdminClient,
): Promise<SyncResult> {
  const startTime = Date.now();
  console.log(`${MODULE} ═══ Starting Lark Admin sync ═══`);

  // Step 1 & 2: Fetch from Lark
  const { departments, users } = await adminClient.fetchAll();

  // Step 3: Upsert departments
  const deptResult = await syncDepartments(prisma, departments);

  // Step 4 & 5: Upsert employees
  const empResult = await syncUsers(prisma, users, departments);

  // Step 6: Log sync job
  const durationMs = Date.now() - startTime;
  const syncedAt = new Date().toISOString();

  try {
    await prisma.syncJob.create({
      data: {
        jobType: 'EMPLOYEES_ADMIN',
        direction: 'INBOUND',
        status: 'COMPLETED',
        startedAt: new Date(startTime),
        finishedAt: new Date(),
        recordsProcessed: users.length,
        recordsCreated: empResult.created,
        recordsUpdated: empResult.updated,
        metadata: {
          source: 'lark_admin_contacts_v3',
          departments: deptResult,
          employees: empResult,
        },
      },
    });
  } catch (e) {
    console.warn(`${MODULE} Could not log sync job:`, (e as Error).message);
  }

  const result: SyncResult = {
    departments: deptResult,
    employees: empResult,
    syncedAt,
    durationMs,
  };

  console.log(`${MODULE} ═══ Sync complete in ${durationMs}ms ═══`);
  console.log(`${MODULE}   Departments: ${deptResult.created} created, ${deptResult.updated} updated`);
  console.log(`${MODULE}   Employees: ${empResult.created} created, ${empResult.updated} updated, ${empResult.deactivated} deactivated`);

  return result;
}

// ─── Department Sync ────────────────────────────────────────

async function syncDepartments(
  prisma: PrismaClient,
  departments: LarkDepartment[],
): Promise<{ created: number; updated: number; total: number }> {
  let created = 0;
  let updated = 0;

  for (const dept of departments) {
    try {
      const existing = await (prisma as any).department?.findUnique({
        where: { larkDeptId: dept.open_department_id },
      });

      const data = {
        name: dept.name,
        parentLarkDeptId: dept.parent_department_id || null,
        memberCount: dept.member_count || 0,
        isDeleted: dept.status?.is_deleted || false,
      };

      if (existing) {
        await (prisma as any).department.update({
          where: { larkDeptId: dept.open_department_id },
          data,
        });
        updated++;
      } else {
        await (prisma as any).department.create({
          data: { larkDeptId: dept.open_department_id, ...data },
        });
        created++;
      }
    } catch (e) {
      // Table may not exist yet — skip silently
      console.log(`${MODULE} Department table not available, storing in employee metadata`);
      break;
    }
  }

  return { created, updated, total: departments.length };
}

// ─── User Sync ──────────────────────────────────────────────

/** Build department name map for lookup */
function buildDeptNameMap(departments: LarkDepartment[]): Map<string, string> {
  return new Map(departments.map(d => [d.open_department_id, d.name]));
}

async function syncUsers(
  prisma: PrismaClient,
  users: LarkUser[],
  departments: LarkDepartment[],
): Promise<{ created: number; updated: number; deactivated: number; total: number }> {
  let created = 0;
  let updated = 0;
  let deactivated = 0;
  const deptMap = buildDeptNameMap(departments);

  // Collect all synced user IDs to detect removals
  const syncedUserIds = new Set<string>();

  for (const user of users) {
    // Lark user_id is the primary identifier for API calls
    const larkUserId = user.user_id || user.open_id;
    // Displayed employee code follows Lark Admin user_id. employee_no is kept in metadata for payroll/business rules.
    const employeeCode = user.user_id || normalizeAsvCode(larkUserId);
    syncedUserIds.add(larkUserId);

    // Resolve primary department name
    const primaryDeptId = user.department_ids?.[0] || '';
    const department = deptMap.get(primaryDeptId) || 'Chưa phân bổ';

    // Determine status
    const isResigned = user.status?.is_resigned || false;
    const isActive = user.status?.is_activated && !isResigned;
    const status = isResigned ? 'INACTIVE' : isActive ? 'ACTIVE' : 'ACTIVE';

    const isBod = department.toUpperCase() === 'BOD';
    const data = {
      fullName: user.name || user.en_name || 'N/A',
      department,
      position: user.job_title || (isBod ? 'BOD' : 'N/A'),
      scheduleType: 'OFFICE' as const,
      employmentType: (isBod ? 'M' : EMPLOYEE_TYPE_MAP[user.employee_type || 1] || 'FT') as any,
      joinDate: user.join_time ? new Date(user.join_time * 1000) : null,
      leaveDate: null as Date | null,
      status: status as any,
      email: user.email || user.enterprise_email || null,
      mobile: user.mobile || null,
      openId: user.open_id,
      unionId: user.union_id || null,
      employeeCode,
      larkMetadata: {
        source: 'admin_contacts_v3',
        syncedAt: new Date().toISOString(),
        avatarUrl: user.avatar?.avatar_240 || user.avatar?.avatar_origin || null,
        gender: user.gender,
        adminUserId: user.user_id || null,
        employeeNo: user.employee_no || null,
        employeeType: user.employee_type,
        departmentIds: user.department_ids || [],
        leaderUserId: user.leader_user_id || null,
        city: user.city || null,
        country: user.country || null,
        isFrozen: user.status?.is_frozen || false,
        isTenantManager: user.is_tenant_manager || false,
      },
    };

    try {
      // Try to find by userId first, then by openId, then by employeeCode
      let existing = await prisma.employee.findUnique({
        where: { userId: larkUserId },
      });
      if (!existing && user.open_id) {
        existing = await prisma.employee.findFirst({
          where: { openId: user.open_id },
        });
      }
      if (!existing && employeeCode) {
        existing = await prisma.employee.findFirst({
          where: { OR: [{ employeeCode }, { userId: employeeCode }] },
        });
      }

      if (existing) {
        await prisma.employee.update({
          where: { id: existing.id },
          data: { userId: larkUserId, ...data },
        });
        updated++;
      } else {
        await prisma.employee.create({
          data: { userId: larkUserId, ...data },
        });
        created++;
      }
    } catch (e) {
      console.warn(`${MODULE} Error upserting user ${larkUserId} (${user.name}):`, (e as Error).message);
    }
  }

  // Deactivate employees that no longer exist in Lark
  try {
    const dbEmployees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { userId: true },
    });

    for (const dbEmp of dbEmployees) {
      if (!syncedUserIds.has(dbEmp.userId)) {
        await prisma.employee.update({
          where: { userId: dbEmp.userId },
          data: { status: 'INACTIVE' as any },
        });
        deactivated++;
      }
    }
  } catch (e) {
    console.warn(`${MODULE} Error deactivating removed users:`, (e as Error).message);
  }

  return { created, updated, deactivated, total: users.length };
}
