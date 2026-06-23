import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_SUBMISSION_POLICY_CONFIG,
  normalizeSubmissionPolicyConfig,
  type SubmissionPolicyConfig,
} from './ot-calculator.js';

export const SUBMISSION_POLICY_SETTING_KEYS = {
  enabled: 'approval_submission_policy_enabled',
  requiredDaysBefore: 'approval_submission_required_days_before',
  otAllowedEarlyDaysBefore: 'approval_ot_allowed_early_days_before',
  otAllowedLateDaysAfter: 'approval_ot_allowed_late_days_after',
} as const;

function parseBooleanSetting(value: string | null | undefined): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'enabled', 'bat', 'bật'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', 'disabled', 'tat', 'tắt'].includes(normalized)) return false;
  return undefined;
}

export async function getApprovalSubmissionPolicyConfig(
  prisma: PrismaClient,
): Promise<SubmissionPolicyConfig> {
  const settings = await prisma.payrollSetting.findMany({
    where: {
      category: 'general',
      key: { in: Object.values(SUBMISSION_POLICY_SETTING_KEYS) },
      policyVersion: { category: 'general', status: 'ACTIVE' },
    },
    select: { key: true, value: true },
  });

  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));
  return normalizeSubmissionPolicyConfig({
    enabled: parseBooleanSetting(byKey.get(SUBMISSION_POLICY_SETTING_KEYS.enabled))
      ?? DEFAULT_SUBMISSION_POLICY_CONFIG.enabled,
    requiredDaysBefore: Number(byKey.get(SUBMISSION_POLICY_SETTING_KEYS.requiredDaysBefore)
      ?? DEFAULT_SUBMISSION_POLICY_CONFIG.requiredDaysBefore),
    otAllowedEarlyDaysBefore: Number(byKey.get(SUBMISSION_POLICY_SETTING_KEYS.otAllowedEarlyDaysBefore)
      ?? DEFAULT_SUBMISSION_POLICY_CONFIG.otAllowedEarlyDaysBefore),
    otAllowedLateDaysAfter: Number(byKey.get(SUBMISSION_POLICY_SETTING_KEYS.otAllowedLateDaysAfter)
      ?? DEFAULT_SUBMISSION_POLICY_CONFIG.otAllowedLateDaysAfter),
  });
}
