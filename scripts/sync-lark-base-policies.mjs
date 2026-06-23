/**
 * Sync Lark Base → Database
 * Đồng bộ: Thông tin lương, Thuế, BHXH từ Lark Base vào PostgreSQL
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: 'packages/api/.env' });
loadDotenv();

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const APP_TOKEN = process.env.LARK_APP_TOKEN;
const BASE_URL = 'https://open.larksuite.com/open-apis';

if (!APP_ID || !APP_SECRET || !APP_TOKEN) {
  throw new Error('Missing LARK_APP_ID, LARK_APP_SECRET, or LARK_APP_TOKEN in environment');
}

// Table IDs from exploration
const TABLES = {
  SALARY: 'tblRTOr2MmfemvO7',     // Thông tin lương, phúc lợi
  TAX: 'tblR2p8W8fbxZ6yF',         // Thông tin thuế, bảo hiểm
  INSURANCE: 'tblkKgPs4299uRUU',   // BHXH, BHYT, BHTN
};

// ─── Auth ───────────────────────────────────────────────────

async function getToken() {
  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  return data.tenant_access_token;
}

async function fetchAllRecords(token, tableId) {
  const records = [];
  let pageToken = undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.code !== 0) { console.error('Fetch error:', data); break; }
    records.push(...(data.data.items || []));
    if (!data.data.has_more) break;
    pageToken = data.data.page_token;
  }
  return records;
}

// ─── Field Extractors ───────────────────────────────────────

function getFieldValue(fields, key) {
  const v = fields[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v.text || v.name || null;
  }
  if (Array.isArray(v)) {
    return v.map(x => typeof x === 'object' ? (x.text || x.name || '') : x).join(', ');
  }
  return v;
}

function getNumericField(fields, key) {
  const v = getFieldValue(fields, key);
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function getUserId(fields) {
  return getFieldValue(fields, 'Mã số nhân viên') || getFieldValue(fields, 'Mã số Nhân viên');
}

// ─── Main Sync ──────────────────────────────────────────────

async function main() {
  // Dynamic import Prisma
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  console.log('🔑 Getting Lark token...');
  const token = await getToken();
  console.log('✅ Token acquired\n');

  // Current period key
  const now = new Date();
  const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  console.log(`📅 Period key: ${periodKey}\n`);

  // ═══ 1. Sync Salary Policies ══════════════════════════════
  console.log('═══ Syncing Salary Policies ═══');
  const salaryRecords = await fetchAllRecords(token, TABLES.SALARY);
  console.log(`  Fetched ${salaryRecords.length} salary records`);

  let salaryCreated = 0, salaryUpdated = 0;
  for (const record of salaryRecords) {
    const f = record.fields;
    const userId = getUserId(f);
    if (!userId) continue;

    // Find employee
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (!emp) { console.log(`  ⚠ Employee ${userId} not found`); continue; }

    const isCurrent = f['Là chính sách hiện tại'] === true || getFieldValue(f, 'Trạng thái record chính sách') === 'Đang áp dụng';

    const data = {
      periodKey,
      isCurrent,
      offerSalary: getNumericField(f, 'Lương offer'),
      ratio: getNumericField(f, 'Tỷ lệ') || 1,
      baseSalary: getNumericField(f, 'Lương'),
      rankAllowance: getNumericField(f, 'Phụ cấp cấp bậc'),
      bpqlAllowance: getNumericField(f, 'Phụ cấp BPQL'),
      salesAllowance: getNumericField(f, 'Phụ cấp kinh doanh'),
      technicalAllowance: getNumericField(f, 'Phụ cấp kỹ thuật'),
      languageAllowance: getNumericField(f, 'Phụ cấp ngoại ngữ'),
      housingAllowance: getNumericField(f, 'Phụ cấp nhà ở'),
      transportAllowance: getNumericField(f, 'Phụ cấp đi lại'),
      mealAllowance: getNumericField(f, 'Phụ cấp ăn uống'),
      phoneAllowance: getNumericField(f, 'Phụ cấp điện thoại'),
      attendanceAllowance: getNumericField(f, 'Phụ cấp chuyên cần'),
      dailyRate: getNumericField(f, 'Lương theo ngày'),
      hourlyRate: getNumericField(f, 'Lương theo giờ'),
      larkRecordId: record.record_id,
    };

    try {
      const existing = await prisma.salaryPolicy.findUnique({
        where: { employeeId_periodKey: { employeeId: emp.id, periodKey } },
      });
      if (existing) {
        await prisma.salaryPolicy.update({ where: { id: existing.id }, data });
        salaryUpdated++;
      } else {
        await prisma.salaryPolicy.create({ data: { employeeId: emp.id, ...data } });
        salaryCreated++;
      }
    } catch (e) {
      console.error(`  ❌ Error for ${userId}:`, e.message);
    }
  }
  console.log(`  ✅ Salary: ${salaryCreated} created, ${salaryUpdated} updated\n`);

  // ═══ 2. Sync Tax Policies ═════════════════════════════════
  console.log('═══ Syncing Tax Policies ═══');
  const taxRecords = await fetchAllRecords(token, TABLES.TAX);
  console.log(`  Fetched ${taxRecords.length} tax records`);

  let taxCreated = 0, taxUpdated = 0;
  for (const record of taxRecords) {
    const f = record.fields;
    const userId = getUserId(f);
    if (!userId) continue;

    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (!emp) continue;

    const data = {
      periodKey,
      isCurrent: f['Là chính sách hiện tại'] === true,
      personalDeduction: getNumericField(f, 'Giảm trừ bản thân') || 11000000,
      dependents: Math.round(getNumericField(f, 'Số người phụ thuộc')),
      dependentDeduction: getNumericField(f, 'Giảm trừ người phụ thuộc'),
      taxCode: getFieldValue(f, 'Mã số thuế') || null,
      larkRecordId: record.record_id,
    };

    try {
      const existing = await prisma.taxPolicy.findUnique({
        where: { employeeId_periodKey: { employeeId: emp.id, periodKey } },
      });
      if (existing) {
        await prisma.taxPolicy.update({ where: { id: existing.id }, data });
        taxUpdated++;
      } else {
        await prisma.taxPolicy.create({ data: { employeeId: emp.id, ...data } });
        taxCreated++;
      }
    } catch (e) {
      console.error(`  ❌ Error for ${userId}:`, e.message);
    }
  }
  console.log(`  ✅ Tax: ${taxCreated} created, ${taxUpdated} updated\n`);

  // ═══ 3. Sync Insurance Policies ═══════════════════════════
  console.log('═══ Syncing Insurance Policies ═══');
  const insRecords = await fetchAllRecords(token, TABLES.INSURANCE);
  console.log(`  Fetched ${insRecords.length} insurance records`);

  let insCreated = 0, insUpdated = 0;
  for (const record of insRecords) {
    const f = record.fields;
    const userId = getUserId(f);
    if (!userId) continue;

    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (!emp) continue;

    const data = {
      periodKey,
      isCurrent: f['Là chính sách hiện tại'] === true,
      insuranceBasis: getNumericField(f, 'Lương offer dùng tính BH') || getNumericField(f, 'Lương offer snapshot'),
      bhxhEmployee: getNumericField(f, 'BHXH NLĐ snapshot') || getNumericField(f, 'BHXH (8%)'),
      bhytEmployee: getNumericField(f, 'BHYT NLĐ snapshot') || getNumericField(f, 'BHYT (1.5%)'),
      bhtnEmployee: getNumericField(f, 'BHTN NLĐ snapshot') || getNumericField(f, 'BHTN (1%)'),
      totalEmployee: getNumericField(f, 'Tổng BH NLĐ snapshot') || getNumericField(f, 'Tổng cộng BH NLĐ'),
      bhxhEmployer: getNumericField(f, 'BHXH DN snapshot') || getNumericField(f, 'BHXH (17.5%)'),
      bhytEmployer: getNumericField(f, 'BHYT DN snapshot') || getNumericField(f, 'BHYT DN (3%)'),
      bhtnEmployer: getNumericField(f, 'BHTN DN snapshot') || getNumericField(f, 'BHTN DN (1%)'),
      totalEmployer: getNumericField(f, 'Tổng BH DN snapshot') || getNumericField(f, 'Tổng cộng BH DN'),
      grandTotal: getNumericField(f, 'Tổng chi phí BH snapshot') || getNumericField(f, 'Tổng cộng chi phí BH (cty+ staff)'),
      larkRecordId: record.record_id,
    };

    try {
      const existing = await prisma.insurancePolicy.findUnique({
        where: { employeeId_periodKey: { employeeId: emp.id, periodKey } },
      });
      if (existing) {
        await prisma.insurancePolicy.update({ where: { id: existing.id }, data });
        insUpdated++;
      } else {
        await prisma.insurancePolicy.create({ data: { employeeId: emp.id, ...data } });
        insCreated++;
      }
    } catch (e) {
      console.error(`  ❌ Error for ${userId}:`, e.message);
    }
  }
  console.log(`  ✅ Insurance: ${insCreated} created, ${insUpdated} updated\n`);

  // ═══ Summary ══════════════════════════════════════════════
  const counts = {
    salary: await prisma.salaryPolicy.count(),
    tax: await prisma.taxPolicy.count(),
    insurance: await prisma.insurancePolicy.count(),
  };
  console.log('═══ SYNC COMPLETE ═══');
  console.log(`  📊 Salary policies: ${counts.salary}`);
  console.log(`  📊 Tax policies: ${counts.tax}`);
  console.log(`  📊 Insurance policies: ${counts.insurance}`);

  await prisma.$disconnect();
}

main().catch(console.error);
