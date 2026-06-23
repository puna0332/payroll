/**
 * Lark Contacts Sync Script
 * Fetches departments + users from Lark Admin API → outputs JSON
 * 
 * Usage: node --experimental-modules sync-lark-employees.mjs
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: 'packages/api/.env' });
loadDotenv();

const LARK_APP_ID = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;

if (!LARK_APP_ID || !LARK_APP_SECRET) {
  throw new Error('Missing LARK_APP_ID or LARK_APP_SECRET in environment');
}

// Lark uses larksuite.com for international, feishu.cn for China
const BASE_URL = 'https://open.larksuite.com/open-apis';

// ─── 1. Get Tenant Access Token ─────────────────────────────

async function getTenantToken() {
  console.log('🔑 Getting tenant access token...');
  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: LARK_APP_ID,
      app_secret: LARK_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    // Try feishu.cn (China version)
    console.log('⚠️  larksuite.com failed, trying feishu.cn...');
    const res2 = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
      }),
    });
    const data2 = await res2.json();
    if (data2.code !== 0 && !data2.tenant_access_token) {
      console.error('❌ Token failed:', JSON.stringify(data2));
      throw new Error(`Token failed: ${JSON.stringify(data2)}`);
    }
    console.log('✅ Got token from feishu.cn, expires in', data2.expire, 's');
    return { token: data2.tenant_access_token, base: 'https://open.feishu.cn/open-apis' };
  }
  console.log('✅ Got token from larksuite.com, expires in', data.expire, 's');
  return { token: data.tenant_access_token, base: BASE_URL };
}

// ─── 2. Fetch Departments (recursive) ───────────────────────

async function fetchDepartments(token, baseUrl, parentId = '0', pageToken = '') {
  const url = new URL(`${baseUrl}/contact/v3/departments/${parentId}/children`);
  url.searchParams.set('page_size', '50');
  url.searchParams.set('department_id_type', 'open_department_id');
  if (pageToken) url.searchParams.set('page_token', pageToken);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) {
    console.error(`❌ Dept fetch error (parent=${parentId}):`, data.msg);
    return [];
  }

  let departments = data.data?.items || [];
  console.log(`  📁 Found ${departments.length} departments under ${parentId === '0' ? 'root' : parentId}`);

  // Pagination
  if (data.data?.has_more && data.data?.page_token) {
    const more = await fetchDepartments(token, baseUrl, parentId, data.data.page_token);
    departments = [...departments, ...more];
  }

  // Recurse into children
  const allDepts = [...departments];
  for (const dept of departments) {
    const children = await fetchDepartments(token, baseUrl, dept.open_department_id);
    allDepts.push(...children);
  }

  return allDepts;
}

// ─── 3. Fetch Users under Department ────────────────────────

async function fetchUsersInDept(token, baseUrl, deptId, pageToken = '') {
  const url = new URL(`${baseUrl}/contact/v3/users/find_by_department`);
  url.searchParams.set('department_id', deptId);
  url.searchParams.set('page_size', '50');
  url.searchParams.set('user_id_type', 'open_id');
  url.searchParams.set('department_id_type', 'open_department_id');
  if (pageToken) url.searchParams.set('page_token', pageToken);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) {
    console.error(`  ❌ User fetch error (dept=${deptId}):`, data.code, data.msg);
    return [];
  }

  let users = data.data?.items || [];

  if (data.data?.has_more && data.data?.page_token) {
    const more = await fetchUsersInDept(token, baseUrl, deptId, data.data.page_token);
    users = [...users, ...more];
  }

  return users;
}

// ─── 4. Main ────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('🚀 Lark Contacts Sync — Asnova Payroll');
  console.log('═══════════════════════════════════════\n');

  // Step 1: Auth
  const { token, base } = await getTenantToken();

  // Step 2: Fetch departments
  console.log('\n📂 Fetching departments...');
  const departments = await fetchDepartments(token, base);
  console.log(`\n✅ Total departments: ${departments.length}`);

  if (departments.length > 0) {
    console.log('\n--- Departments ---');
    for (const d of departments) {
      console.log(`  📁 ${d.name} (${d.open_department_id}) — ${d.member_count || 0} members`);
    }
  }

  // Step 3: Fetch all users (root dept + all sub-depts)
  console.log('\n👥 Fetching users from all departments...');
  const allUsers = new Map(); // deduplicate by open_id

  // Root department (0)
  const rootUsers = await fetchUsersInDept(token, base, '0');
  for (const u of rootUsers) {
    allUsers.set(u.open_id, u);
  }
  console.log(`  Root department: ${rootUsers.length} users`);

  // Sub-departments
  for (const dept of departments) {
    const users = await fetchUsersInDept(token, base, dept.open_department_id);
    for (const u of users) {
      allUsers.set(u.open_id, u);
    }
    if (users.length > 0) {
      console.log(`  ${dept.name}: ${users.length} users`);
    }
  }

  const uniqueUsers = Array.from(allUsers.values());
  console.log(`\n✅ Total unique users: ${uniqueUsers.length}`);

  // Step 4: Output
  console.log('\n═══════════════════════════════════════');
  console.log('📋 Employee Summary');
  console.log('═══════════════════════════════════════\n');

  const employeeTypes = { 1: 'Regular', 2: 'Intern', 3: 'Outsource', 4: 'Contractor', 5: 'Consultant' };

  for (const u of uniqueUsers) {
    const status = u.status?.is_resigned ? '❌ Resigned' : u.status?.is_activated ? '✅ Active' : '⏳ Pending';
    const empType = employeeTypes[u.employee_type] || `Type-${u.employee_type}`;
    const joinDate = u.join_time ? new Date(u.join_time * 1000).toLocaleDateString('vi-VN') : 'N/A';
    
    console.log(`  ${u.name || u.en_name || 'Unknown'}`);
    console.log(`    Open ID: ${u.open_id}`);
    console.log(`    Employee #: ${u.employee_no || 'N/A'}`);
    console.log(`    Title: ${u.job_title || 'N/A'}`);
    console.log(`    Email: ${u.email || u.enterprise_email || 'N/A'}`);
    console.log(`    Mobile: ${u.mobile || 'N/A'}`);
    console.log(`    Type: ${empType}`);
    console.log(`    Status: ${status}`);
    console.log(`    Join: ${joinDate}`);
    console.log(`    Departments: ${(u.department_ids || []).join(', ')}`);
    console.log('');
  }

  // Write JSON output
  const output = {
    syncedAt: new Date().toISOString(),
    departments: departments.map(d => ({
      id: d.open_department_id,
      name: d.name,
      parentId: d.parent_department_id,
      memberCount: d.member_count || 0,
      status: d.status,
    })),
    employees: uniqueUsers.map(u => ({
      openId: u.open_id,
      unionId: u.union_id,
      userId: u.user_id,
      name: u.name,
      enName: u.en_name,
      nickname: u.nickname,
      email: u.email,
      enterpriseEmail: u.enterprise_email,
      mobile: u.mobile,
      gender: u.gender,
      avatarUrl: u.avatar?.avatar_240 || u.avatar?.avatar_origin,
      employeeNo: u.employee_no,
      employeeType: u.employee_type,
      jobTitle: u.job_title,
      city: u.city,
      joinTime: u.join_time,
      isActivated: u.status?.is_activated,
      isResigned: u.status?.is_resigned,
      isFrozen: u.status?.is_frozen,
      departmentIds: u.department_ids,
      leaderUserId: u.leader_user_id,
    })),
  };

  const fs = await import('fs');
  const outputPath = new URL('./lark-sync-output.json', import.meta.url);
  fs.writeFileSync(new URL(outputPath), JSON.stringify(output, null, 2));
  console.log(`\n💾 Output saved to: lark-sync-output.json`);
  console.log(`   ${output.departments.length} departments, ${output.employees.length} employees`);
}

main().catch(console.error);
