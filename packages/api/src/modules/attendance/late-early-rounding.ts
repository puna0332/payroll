import type { PrismaClient } from '@prisma/client';
import { round } from '../../shared/utils/round.js';

export type LateEarlyRoundingRules = {
  firstQuarter: number;
  secondQuarter: number;
  thirdQuarter: number;
  fourthQuarter: number;
};

export const DEFAULT_LATE_EARLY_ROUNDING_RULES: LateEarlyRoundingRules = {
  firstQuarter: 0.25,
  secondQuarter: 0.5,
  thirdQuarter: 0.75,
  fourthQuarter: 1,
};

const SETTING_KEYS: Record<keyof LateEarlyRoundingRules, string> = {
  firstQuarter: 'late_early_round_1_15_minutes',
  secondQuarter: 'late_early_round_16_30_minutes',
  thirdQuarter: 'late_early_round_31_45_minutes',
  fourthQuarter: 'late_early_round_46_60_minutes',
};

function parseRuleValue(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function getLateEarlyRoundingRules(prisma: PrismaClient): Promise<LateEarlyRoundingRules> {
  const settings = await prisma.payrollSetting.findMany({
    where: {
      category: 'general',
      key: { in: Object.values(SETTING_KEYS) },
      policyVersion: { status: 'ACTIVE' },
    },
    select: { key: true, value: true },
  });
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  return {
    firstQuarter: parseRuleValue(byKey.get(SETTING_KEYS.firstQuarter), DEFAULT_LATE_EARLY_ROUNDING_RULES.firstQuarter),
    secondQuarter: parseRuleValue(byKey.get(SETTING_KEYS.secondQuarter), DEFAULT_LATE_EARLY_ROUNDING_RULES.secondQuarter),
    thirdQuarter: parseRuleValue(byKey.get(SETTING_KEYS.thirdQuarter), DEFAULT_LATE_EARLY_ROUNDING_RULES.thirdQuarter),
    fourthQuarter: parseRuleValue(byKey.get(SETTING_KEYS.fourthQuarter), DEFAULT_LATE_EARLY_ROUNDING_RULES.fourthQuarter),
  };
}

export function roundLateEarlyHours(rawHours: number, rules: LateEarlyRoundingRules): number {
  if (!Number.isFinite(rawHours) || rawHours <= 0) return 0;

  const totalMinutes = Math.ceil(rawHours * 60 - 0.000001);
  const fullHours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;

  if (remainder === 0) return fullHours;
  if (remainder <= 15) return round(fullHours + rules.firstQuarter, 2);
  if (remainder <= 30) return round(fullHours + rules.secondQuarter, 2);
  if (remainder <= 45) return round(fullHours + rules.thirdQuarter, 2);
  return round(fullHours + rules.fourthQuarter, 2);
}
