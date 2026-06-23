/**
 * Settings Routes — PolicyVersion-based CRUD
 * Mỗi category có nhiều versions, 1 version ACTIVE, click vào xem/chỉnh rules bên trong
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../shared/db/prisma.js';

const router = Router();

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new Error(`Route param ${name} is required`);
  }
  return value;
}

// ─── Default Settings Template ──────────────────────────────

const TEMPLATES: Record<string, Array<{ key: string; value: string; label: string; description: string; dataType: string; sortOrder: number }>> = {
  insurance: [
    { key: 'bhxh_employee_rate', value: '8', label: 'BHXH — Người lao động', description: 'Tỷ lệ đóng BHXH phía NLĐ (%)', dataType: 'percent', sortOrder: 1 },
    { key: 'bhyt_employee_rate', value: '1.5', label: 'BHYT — Người lao động', description: 'Tỷ lệ đóng BHYT phía NLĐ (%)', dataType: 'percent', sortOrder: 2 },
    { key: 'bhtn_employee_rate', value: '1', label: 'BHTN — Người lao động', description: 'Tỷ lệ đóng BHTN phía NLĐ (%)', dataType: 'percent', sortOrder: 3 },
    { key: 'bhxh_employer_rate', value: '17.5', label: 'BHXH — Doanh nghiệp', description: 'Tỷ lệ đóng BHXH phía DN (%)', dataType: 'percent', sortOrder: 4 },
    { key: 'bhyt_employer_rate', value: '3', label: 'BHYT — Doanh nghiệp', description: 'Tỷ lệ đóng BHYT phía DN (%)', dataType: 'percent', sortOrder: 5 },
    { key: 'bhtn_employer_rate', value: '1', label: 'BHTN — Doanh nghiệp', description: 'Tỷ lệ đóng BHTN phía DN (%)', dataType: 'percent', sortOrder: 6 },
    { key: 'insurance_salary_cap', value: '46800000', label: 'Mức trần đóng BHXH', description: '20 lần lương cơ sở (2,340,000 × 20)', dataType: 'currency', sortOrder: 7 },
    { key: 'base_salary_region', value: '4960000', label: 'Lương tối thiểu vùng', description: 'Lương tối thiểu vùng I (2024)', dataType: 'currency', sortOrder: 8 },
  ],
  tax: [
    { key: 'personal_deduction', value: '11000000', label: 'Giảm trừ bản thân', description: 'Mức giảm trừ gia cảnh cho bản thân', dataType: 'currency', sortOrder: 1 },
    { key: 'dependent_deduction', value: '4400000', label: 'Giảm trừ người phụ thuộc', description: 'Giảm trừ cho mỗi người phụ thuộc', dataType: 'currency', sortOrder: 2 },
    { key: 'tax_brackets', value: JSON.stringify([
      { from: 0, to: 5000000, rate: 5 }, { from: 5000000, to: 10000000, rate: 10 },
      { from: 10000000, to: 18000000, rate: 15 }, { from: 18000000, to: 32000000, rate: 20 },
      { from: 32000000, to: 52000000, rate: 25 }, { from: 52000000, to: 80000000, rate: 30 },
      { from: 80000000, to: null, rate: 35 },
    ]), label: 'Biểu thuế lũy tiến', description: 'Biểu thuế TNCN lũy tiến từng phần (7 bậc)', dataType: 'json', sortOrder: 3 },
  ],
  benefit: [
    { key: 'meal_allowance', value: '730000', label: 'Phụ cấp ăn trưa', description: 'Tiền ăn trưa hàng tháng (không tính thuế ≤ 730,000)', dataType: 'currency', sortOrder: 1 },
    { key: 'transport_allowance', value: '500000', label: 'Phụ cấp đi lại', description: 'Phụ cấp xăng xe, đi lại', dataType: 'currency', sortOrder: 2 },
    { key: 'phone_allowance', value: '200000', label: 'Phụ cấp điện thoại', description: 'Phụ cấp điện thoại hàng tháng', dataType: 'currency', sortOrder: 3 },
    { key: 'housing_allowance', value: '0', label: 'Phụ cấp nhà ở', description: 'Phụ cấp tiền nhà (nếu có)', dataType: 'currency', sortOrder: 4 },
    { key: 'attendance_bonus', value: '300000', label: 'Thưởng chuyên cần', description: 'Thưởng đi làm đầy đủ không vắng', dataType: 'currency', sortOrder: 5 },
    { key: 'annual_leave_days', value: '12', label: 'Số ngày phép năm', description: 'Số ngày phép năm tiêu chuẩn', dataType: 'number', sortOrder: 6 },
    { key: 'seniority_leave_bonus', value: '1', label: 'Phép thâm niên', description: 'Số ngày phép thêm mỗi 5 năm thâm niên', dataType: 'number', sortOrder: 7 },
  ],
  general: [
    { key: 'standard_work_hours', value: '8', label: 'Giờ làm chuẩn/ngày', description: 'Số giờ làm việc tiêu chuẩn 1 ngày', dataType: 'number', sortOrder: 1 },
    { key: 'ot_weekday_rate', value: '1.5', label: 'Hệ số OT ngày thường', description: 'Hệ số tăng ca ngày thường', dataType: 'number', sortOrder: 2 },
    { key: 'ot_weekend_rate', value: '2', label: 'Hệ số OT cuối tuần', description: 'Hệ số tăng ca thứ 7, CN', dataType: 'number', sortOrder: 3 },
    { key: 'ot_holiday_rate', value: '3', label: 'Hệ số OT ngày lễ', description: 'Hệ số tăng ca ngày lễ, tết', dataType: 'number', sortOrder: 4 },
    { key: 'ot_night_surcharge', value: '0.3', label: 'Phụ trội OT đêm', description: 'Phụ trội làm đêm (22h-6h)', dataType: 'number', sortOrder: 5 },
    { key: 'late_deduction_per_time', value: '50000', label: 'Trừ đi muộn/lần', description: 'Số tiền trừ mỗi lần đi muộn', dataType: 'currency', sortOrder: 6 },
    { key: 'union_fee_rate', value: '1', label: 'Phí công đoàn', description: 'Tỷ lệ phí công đoàn NLĐ (%)', dataType: 'percent', sortOrder: 7 },
    { key: 'social_insurance_salary_cap', value: '46800000', label: 'Mức trần lương đóng BHXH', description: 'Mức lương tối đa dùng để tính BHXH/BHYT', dataType: 'currency', sortOrder: 8 },
    { key: 'unemployment_insurance_salary_cap', value: '99200000', label: 'Mức trần lương đóng BHTN', description: 'Mức lương tối đa dùng để tính BHTN', dataType: 'currency', sortOrder: 9 },
    { key: 'late_early_round_1_15_minutes', value: '0.25', label: 'Làm tròn trễ/sớm 1-15 phút', description: 'Số giờ ghi nhận khi đi trễ/về sớm từ 1 đến 15 phút', dataType: 'number', sortOrder: 10 },
    { key: 'late_early_round_16_30_minutes', value: '0.5', label: 'Làm tròn trễ/sớm 16-30 phút', description: 'Số giờ ghi nhận khi đi trễ/về sớm từ 16 đến 30 phút', dataType: 'number', sortOrder: 11 },
    { key: 'late_early_round_31_45_minutes', value: '0.75', label: 'Làm tròn trễ/sớm 31-45 phút', description: 'Số giờ ghi nhận khi đi trễ/về sớm từ 31 đến 45 phút', dataType: 'number', sortOrder: 12 },
    { key: 'late_early_round_46_60_minutes', value: '1', label: 'Làm tròn trễ/sớm 46-60 phút', description: 'Số giờ ghi nhận khi đi trễ/về sớm từ 46 đến 60 phút', dataType: 'number', sortOrder: 13 },
    { key: 'approval_submission_policy_enabled', value: 'true', label: 'Bật rule hạn nộp phiếu OT/đổi ca', description: 'Bật thì phiếu OT và phiếu đổi ca bị quá hạn vẫn lưu nhưng không tính, trừ khi được miễn trừ.', dataType: 'boolean', sortOrder: 14 },
    { key: 'approval_submission_required_days_before', value: '1', label: 'Số ngày đổi ca phải nộp trước', description: 'Áp dụng cho phiếu đổi ca. Ví dụ nhập 1: ngày áp dụng 23/06 thì phiếu phải tạo chậm nhất 22/06.', dataType: 'number', sortOrder: 15 },
    { key: 'approval_ot_allowed_early_days_before', value: '1', label: 'Số ngày OT được nộp trước', description: 'Áp dụng cho phiếu OT. Ví dụ nhập 1: OT ngày 20/06 thì phiếu chỉ hợp lệ nếu tạo từ 19/06 trở đi.', dataType: 'number', sortOrder: 16 },
    { key: 'approval_ot_allowed_late_days_after', value: '1', label: 'Số ngày OT được nộp muộn', description: 'Áp dụng cho phiếu OT. Ví dụ nhập 1: OT ngày 20/06 thì phiếu có thể tạo muộn nhất 21/06.', dataType: 'number', sortOrder: 17 },
  ],
};

const DEFAULT_VERSION_NAMES: Record<string, string> = {
  insurance: 'Chính sách BHXH mặc định',
  tax: 'Biểu thuế TNCN hiện hành',
  benefit: 'Phúc lợi & Phụ cấp cơ bản',
  general: 'Cài đặt chung mặc định',
};

// ─── Auto-seed all categories ───────────────────────────────

async function ensureMissingTemplateSettings() {
  let created = 0;

  for (const [category, rules] of Object.entries(TEMPLATES)) {
    const versions = await prisma.policyVersion.findMany({
      where: { category },
      select: { id: true, name: true },
    });

    for (const version of versions) {
      const existingSettings = await prisma.payrollSetting.findMany({
        where: { policyVersionId: version.id },
        select: { id: true, key: true, label: true, description: true, dataType: true, sortOrder: true },
      });
      const existingKeys = new Set(existingSettings.map((setting) => setting.key));
      const missingRules = rules.filter((rule) => !existingKeys.has(rule.key));
      const rulesByKey = new Map(rules.map((rule) => [rule.key, rule]));
      const metadataUpdates = existingSettings
        .map((setting) => ({ setting, rule: rulesByKey.get(setting.key) }))
        .filter(({ setting, rule }) => Boolean(rule) && (
          setting.label !== rule!.label ||
          setting.description !== rule!.description ||
          setting.dataType !== rule!.dataType ||
          setting.sortOrder !== rule!.sortOrder
        ));
      for (const { setting, rule } of metadataUpdates) {
        await prisma.payrollSetting.update({
          where: { id: setting.id },
          data: {
            label: rule!.label,
            description: rule!.description,
            dataType: rule!.dataType,
            sortOrder: rule!.sortOrder,
          },
        });
      }
      if (missingRules.length === 0) continue;

      await prisma.payrollSetting.createMany({
        data: missingRules.map((rule) => ({ ...rule, policyVersionId: version.id, category })),
        skipDuplicates: true,
      });
      created += missingRules.length;

      await prisma.settingChangeLog.create({
        data: {
          policyVersionId: version.id,
          category,
          action: 'UPDATE',
          summary: `Bổ sung ${missingRules.length} cài đặt mặc định còn thiếu`,
          details: JSON.stringify(missingRules.map((rule) => ({ key: rule.key, value: rule.value }))),
        },
      });
    }
  }

  if (created > 0) {
    console.log(`[Settings] Added ${created} missing template settings`);
  }
}

async function seedIfEmpty() {
  const count = await prisma.policyVersion.count();

  if (count === 0) {
    console.log('[Settings] Seeding default policy versions...');
    for (const [category, rules] of Object.entries(TEMPLATES)) {
      const pv = await prisma.policyVersion.create({
        data: {
          category,
          name: DEFAULT_VERSION_NAMES[category] || `${category} v1`,
          version: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date('2025-01-01'),
          description: 'Version khởi tạo mặc định',
        },
      });

      for (const rule of rules) {
        await prisma.payrollSetting.create({
          data: { ...rule, policyVersionId: pv.id, category },
        });
      }

      await prisma.settingChangeLog.create({
        data: {
          policyVersionId: pv.id,
          category,
          action: 'CREATE',
          summary: `Khởi tạo ${DEFAULT_VERSION_NAMES[category]} (v1)`,
          details: JSON.stringify(rules.map(r => ({ key: r.key, value: r.value }))),
        },
      });
    }
    console.log('[Settings] Seeded all categories');
  }

  await ensureMissingTemplateSettings();
}

seedIfEmpty().catch(e => console.warn('[Settings] Seed error:', e));

// ═══════════════════════════════════════════════════════════
// GET /api/settings — All policy versions (grouped by category)
// ═══════════════════════════════════════════════════════════

router.get('/', async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    const where: Record<string, unknown> = {};
    if (category && typeof category === 'string') where.category = category;

    const versions = await prisma.policyVersion.findMany({
      where,
      include: {
        settings: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { settings: true, changeLogs: true } },
      },
      orderBy: [{ category: 'asc' }, { version: 'desc' }],
    });

    // Group by category
    const grouped = versions.reduce<Record<string, typeof versions>>((acc, v) => {
      (acc[v.category] = acc[v.category] || []).push(v);
      return acc;
    }, {});

    // Also return active settings flat (for payroll calc backward compat)
    const activeVersions = versions.filter(v => v.status === 'ACTIVE');
    const activeSettings = activeVersions.flatMap(v => v.settings);

    return res.json({ data: versions, grouped, activeSettings });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/settings/versions/:category — All versions for a category
// ═══════════════════════════════════════════════════════════

router.get('/versions/:category', async (req: Request, res: Response) => {
  try {
    const category = routeParam(req, 'category');
    const versions = await prisma.policyVersion.findMany({
      where: { category },
      include: {
        settings: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { settings: true, changeLogs: true } },
      },
      orderBy: { version: 'desc' },
    });

    return res.json({ data: versions });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/settings/version/:id — Single version with settings
// ═══════════════════════════════════════════════════════════

router.get('/version/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const version = await prisma.policyVersion.findUnique({
      where: { id },
      include: {
        settings: { orderBy: { sortOrder: 'asc' } },
        changeLogs: { orderBy: { changedAt: 'desc' }, take: 20 },
      },
    });

    if (!version) return res.status(404).json({ error: 'Version not found' });
    return res.json({ data: version });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/settings/versions — Create new version (clone from active or scratch)
// ═══════════════════════════════════════════════════════════

router.post('/versions', async (req: Request, res: Response) => {
  try {
    const { category, name, effectiveFrom, description, cloneFromId } = req.body;
    if (!category || !name || !effectiveFrom) {
      return res.status(400).json({ error: 'category, name, effectiveFrom required' });
    }

    // Find max version
    const maxVersion = await prisma.policyVersion.findFirst({
      where: { category },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const newVersionNum = (maxVersion?.version || 0) + 1;

    // Source: clone from specific version or active version
    let sourceSettings: Array<{ key: string; value: string; label: string; description: string | null; dataType: string; sortOrder: number }> = [];
    if (cloneFromId) {
      const source = await prisma.policyVersion.findUnique({
        where: { id: cloneFromId },
        include: { settings: true },
      });
      if (source) sourceSettings = source.settings;
    } else {
      const active = await prisma.policyVersion.findFirst({
        where: { category, status: 'ACTIVE' },
        include: { settings: true },
      });
      if (active) sourceSettings = active.settings;
      else if (TEMPLATES[category]) {
        sourceSettings = TEMPLATES[category].map(t => ({ ...t, description: t.description || null }));
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create version as DRAFT
      const pv = await tx.policyVersion.create({
        data: {
          category,
          name,
          version: newVersionNum,
          status: 'DRAFT',
          effectiveFrom: new Date(effectiveFrom),
          description: description || null,
        },
      });

      // Clone settings
      for (const s of sourceSettings) {
        await tx.payrollSetting.create({
          data: {
            policyVersionId: pv.id,
            category,
            key: s.key,
            value: s.value,
            label: s.label,
            description: s.description,
            dataType: s.dataType,
            sortOrder: s.sortOrder,
          },
        });
      }

      // Log
      await tx.settingChangeLog.create({
        data: {
          policyVersionId: pv.id,
          category,
          action: 'CREATE',
          summary: `Tạo version mới: ${name} (v${newVersionNum})`,
          details: JSON.stringify({ clonedFrom: cloneFromId || 'active', settingsCount: sourceSettings.length }),
        },
      });

      return tx.policyVersion.findUnique({
        where: { id: pv.id },
        include: { settings: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// PUT /api/settings/version/:id — Update version info (name, dates, description)
// ═══════════════════════════════════════════════════════════

router.put('/version/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const { name, effectiveFrom, effectiveTo, description } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (effectiveFrom !== undefined) data.effectiveFrom = new Date(effectiveFrom);
    if (effectiveTo !== undefined) data.effectiveTo = effectiveTo ? new Date(effectiveTo) : null;
    if (description !== undefined) data.description = description;

    const updated = await prisma.policyVersion.update({
      where: { id },
      data,
      include: { settings: { orderBy: { sortOrder: 'asc' } } },
    });

    return res.json({ success: true, data: updated });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// PUT /api/settings/version/:id/rules — Update rules inside a version
// ═══════════════════════════════════════════════════════════

router.put('/version/:id/rules', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const updates: Array<{ id: string; value: string }> = req.body.settings;
    const changeNote = req.body.changeNote || '';
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'settings array required' });

    const version = await prisma.policyVersion.findUnique({
      where: { id },
      include: { settings: true },
    });
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const changes: Array<{ key: string; label: string; oldValue: string; newValue: string }> = [];

    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        const existing = version.settings.find(s => s.id === u.id);
        if (!existing || existing.value === String(u.value)) continue;

        await tx.payrollSetting.update({
          where: { id: u.id },
          data: { value: String(u.value) },
        });

        changes.push({
          key: existing.key,
          label: existing.label,
          oldValue: existing.value,
          newValue: String(u.value),
        });
      }

      if (changes.length > 0) {
        const summaryParts = changes.map(c => `${c.label}: ${c.oldValue}→${c.newValue}`);
        await tx.settingChangeLog.create({
          data: {
            policyVersionId: version.id,
            category: version.category,
            action: 'UPDATE',
            summary: changeNote || `Cập nhật ${changes.length} chỉ số`,
            details: JSON.stringify(changes),
          },
        });
      }
    });

    const updated = await prisma.policyVersion.findUnique({
      where: { id },
      include: { settings: { orderBy: { sortOrder: 'asc' } } },
    });

    return res.json({ success: true, data: updated, changed: changes.length });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/settings/version/:id/activate — Activate a version (deactivate others)
// ═══════════════════════════════════════════════════════════

router.post('/version/:id/activate', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const version = await prisma.policyVersion.findUnique({ where: { id } });
    if (!version) return res.status(404).json({ error: 'Version not found' });

    await prisma.$transaction(async (tx) => {
      // Deactivate all in same category
      const deactivated = await tx.policyVersion.updateMany({
        where: { category: version.category, status: 'ACTIVE' },
        data: { status: 'INACTIVE', effectiveTo: new Date() },
      });

      // Activate this one
      await tx.policyVersion.update({
        where: { id: version.id },
        data: { status: 'ACTIVE', effectiveTo: null },
      });

      // Log deactivations
      if (deactivated.count > 0) {
        await tx.settingChangeLog.create({
          data: {
            policyVersionId: version.id,
            category: version.category,
            action: 'ACTIVATE',
            summary: `Kích hoạt ${version.name} (v${version.version}), vô hiệu ${deactivated.count} version cũ`,
          },
        });
      }
    });

    const updated = await prisma.policyVersion.findUnique({
      where: { id },
      include: { settings: { orderBy: { sortOrder: 'asc' } } },
    });

    return res.json({ success: true, data: updated });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/settings/version/:id/deactivate
// ═══════════════════════════════════════════════════════════

router.post('/version/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    await prisma.policyVersion.update({
      where: { id },
      data: { status: 'INACTIVE', effectiveTo: new Date() },
    });

    const version = await prisma.policyVersion.findUnique({ where: { id } });
    await prisma.settingChangeLog.create({
      data: {
        policyVersionId: id,
        category: version?.category || '',
        action: 'DEACTIVATE',
        summary: 'Vô hiệu hóa version',
      },
    });

    return res.json({ success: true });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/settings/version/:id — Delete a version (only DRAFT/INACTIVE)
// ═══════════════════════════════════════════════════════════

router.delete('/version/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const version = await prisma.policyVersion.findUnique({ where: { id } });
    if (!version) return res.status(404).json({ error: 'Version not found' });
    if (version.status === 'ACTIVE') {
      return res.status(400).json({ error: 'Không thể xóa version đang áp dụng' });
    }

    await prisma.policyVersion.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/settings/changelog/:category — Changelog for a category
// ═══════════════════════════════════════════════════════════

router.get('/changelog/:category', async (req: Request, res: Response) => {
  try {
    const category = routeParam(req, 'category');
    const logs = await prisma.settingChangeLog.findMany({
      where: { category },
      orderBy: { changedAt: 'desc' },
      take: 50,
      include: {
        policyVersion: { select: { name: true, version: true } },
      },
    });

    return res.json({ data: logs });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// ─── POST /api/settings/reset ───────────────────────────────

router.post('/reset', async (_req: Request, res: Response) => {
  try {
    await prisma.settingChangeLog.deleteMany();
    await prisma.payrollSetting.deleteMany();
    await prisma.policyVersion.deleteMany();

    // Re-seed
    for (const [category, rules] of Object.entries(TEMPLATES)) {
      const pv = await prisma.policyVersion.create({
        data: {
          category,
          name: DEFAULT_VERSION_NAMES[category] || `${category} v1`,
          version: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date('2025-01-01'),
          description: 'Version khởi tạo mặc định',
        },
      });
      for (const rule of rules) {
        await prisma.payrollSetting.create({
          data: { ...rule, policyVersionId: pv.id, category },
        });
      }
    }

    return res.json({ success: true, message: 'Đã khôi phục cài đặt mặc định' });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
