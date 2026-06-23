/**
 * Lark Admin Contacts API Client
 * Fetch departments + users trực tiếp từ Lark Admin (Contacts v3)
 * Khác với base.ts (Lark Base/Bitable) — đây là Contacts API
 */

import { getTenantToken } from './auth.js';
import { LARK_BASE_URL, type LarkConfig } from './config.js';

const MODULE = '[Lark:Admin]';

// ─── Types ──────────────────────────────────────────────────

export interface LarkDepartment {
  open_department_id: string;
  name: string;
  parent_department_id: string;
  member_count?: number;
  status?: { is_deleted: boolean };
}

export interface LarkUserStatus {
  is_frozen: boolean;
  is_resigned: boolean;
  is_activated: boolean;
  is_exited: boolean;
  is_unjoin: boolean;
}

export interface LarkUser {
  open_id: string;
  union_id?: string;
  user_id?: string;
  name: string;
  en_name?: string;
  nickname?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  gender?: number;
  avatar?: {
    avatar_72?: string;
    avatar_240?: string;
    avatar_640?: string;
    avatar_origin?: string;
  };
  status?: LarkUserStatus;
  department_ids?: string[];
  leader_user_id?: string;
  city?: string;
  country?: string;
  join_time?: number;
  employee_no?: string;
  employee_type?: number;
  job_title?: string;
  is_tenant_manager?: boolean;
}

// ─── Client ─────────────────────────────────────────────────

export class LarkAdminClient {
  constructor(private config: LarkConfig) {}

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await getTenantToken(this.config);
    const url = new URL(`${LARK_BASE_URL}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`${MODULE} HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`${MODULE} API error: code=${data.code} msg="${data.msg}"`);
    }

    return data.data;
  }

  // ─── Departments ────────────────────────────────────────────

  /**
   * Fetch all departments recursively starting from root (0)
   */
  async fetchAllDepartments(): Promise<LarkDepartment[]> {
    console.log(`${MODULE} Fetching departments...`);
    const allDepts: LarkDepartment[] = [];
    await this._fetchDeptChildren('0', allDepts);
    console.log(`${MODULE} Total departments: ${allDepts.length}`);
    return allDepts;
  }

  private async _fetchDeptChildren(parentId: string, acc: LarkDepartment[], pageToken?: string): Promise<void> {
    const params: Record<string, string> = {
      page_size: '50',
      department_id_type: 'open_department_id',
    };
    if (pageToken) params.page_token = pageToken;

    const data = await this.request<{
      has_more: boolean;
      page_token?: string;
      items?: LarkDepartment[];
    }>(`/contact/v3/departments/${parentId}/children`, params);

    const items = data.items || [];
    acc.push(...items);

    // Pagination
    if (data.has_more && data.page_token) {
      await this._fetchDeptChildren(parentId, acc, data.page_token);
    }

    // Recurse into children
    for (const dept of items) {
      await this._fetchDeptChildren(dept.open_department_id, acc);
    }
  }

  // ─── Users ──────────────────────────────────────────────────

  /**
   * Fetch all users across all departments (deduped by open_id)
   */
  async fetchAllUsers(departmentIds: string[]): Promise<LarkUser[]> {
    console.log(`${MODULE} Fetching users from ${departmentIds.length} departments...`);
    const userMap = new Map<string, LarkUser>();

    // Root department
    await this._fetchUsersInDept('0', userMap);

    // Sub-departments
    for (const deptId of departmentIds) {
      await this._fetchUsersInDept(deptId, userMap);
    }

    const users = Array.from(userMap.values());
    console.log(`${MODULE} Total unique users: ${users.length}`);
    return users;
  }

  private async _fetchUsersInDept(deptId: string, acc: Map<string, LarkUser>, pageToken?: string): Promise<void> {
    const params: Record<string, string> = {
      department_id: deptId,
      page_size: '50',
      user_id_type: 'user_id',
      department_id_type: 'open_department_id',
    };
    if (pageToken) params.page_token = pageToken;

    try {
      const data = await this.request<{
        has_more: boolean;
        page_token?: string;
        items?: LarkUser[];
      }>('/contact/v3/users/find_by_department', params);

      for (const user of data.items || []) {
        acc.set(user.open_id, user);
      }

      if (data.has_more && data.page_token) {
        await this._fetchUsersInDept(deptId, acc, data.page_token);
      }
    } catch (err) {
      // Some departments may not be accessible — log & continue
      console.warn(`${MODULE} Cannot fetch users for dept ${deptId}:`, (err as Error).message);
    }
  }

  // ─── Convenience ──────────────────────────────────────────

  /**
   * Full sync: departments + all users → structured result
   */
  async fetchAll(): Promise<{ departments: LarkDepartment[]; users: LarkUser[] }> {
    const departments = await this.fetchAllDepartments();
    const deptIds = departments.map(d => d.open_department_id);
    const users = await this.fetchAllUsers(deptIds);
    return { departments, users };
  }
}
