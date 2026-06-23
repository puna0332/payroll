/**
 * PIT Calculator — Thuế Thu nhập Cá nhân
 * 7 progressive tax brackets (Biểu thuế lũy tiến từng phần)
 *
 * Special cases:
 * - P-type (Part-time): flat 10% on gross income
 * - GD (Giám đốc): PIT = 0
 */

import { round } from '../../shared/utils/round.js';
import { PIT_BRACKETS } from '../../config/constants.js';

// ─── Types ──────────────────────────────────────────────────

export interface PitInput {
  grossIncome: number;
  insuranceEmployee: number;
  taxExemptIncome: number;
  personalDeduction: number;
  dependentDeduction: number;
  employmentType?: string;
}

export interface BracketDetail {
  bracket: number;
  taxableInBracket: number;
  tax: number;
  rate: number;
}

export interface PitResult {
  taxableIncome: number;
  pitAmount: number;
  effectiveRate: number;
  bracketDetails: BracketDetail[];
}

// ─── Zero Result ────────────────────────────────────────────

const ZERO_RESULT: PitResult = {
  taxableIncome: 0,
  pitAmount: 0,
  effectiveRate: 0,
  bracketDetails: [],
};

// ─── Main Function ──────────────────────────────────────────

/**
 * Calculate PIT using progressive tax brackets.
 *
 * Formula:
 * 1. assessableIncome = gross - taxExemptIncome - insurance
 * 2. taxableIncome = assessable - personalDeduction - dependentDeduction
 * 3. Apply payroll-template brackets bottom-up
 *
 * @example
 * calculatePit({
 *   grossIncome: 30_000_000,
 *   insuranceEmployee: 2_400_000,
 *   taxExemptIncome: 1_030_000,
 *   personalDeduction: 15_500_000,
 *   dependentDeduction: 6_200_000,
 * })
 */
export function calculatePit(input: PitInput): PitResult {
  const { grossIncome, insuranceEmployee, taxExemptIncome, personalDeduction, dependentDeduction, employmentType } = input;

  // Special case: GD (Giám đốc) = PIT = 0
  if (employmentType === 'M') {
    return { ...ZERO_RESULT };
  }

  // Standard progressive calculation
  const assessableIncome = grossIncome - taxExemptIncome - insuranceEmployee;
  const familyDeduction = employmentType === 'P' ? 0 : personalDeduction + dependentDeduction;
  const taxableIncome = Math.max(assessableIncome - familyDeduction, 0);

  if (taxableIncome <= 0) {
    return { ...ZERO_RESULT };
  }

  // Apply 7 brackets
  let remaining = taxableIncome;
  let totalTax = 0;
  let prevCeiling = 0;
  const bracketDetails: BracketDetail[] = [];

  for (let i = 0; i < PIT_BRACKETS.length; i++) {
    const bracket = PIT_BRACKETS[i];
    const bracketWidth = bracket.ceiling === Infinity
      ? remaining
      : bracket.ceiling - prevCeiling;

    const taxableInBracket = Math.min(remaining, bracketWidth);
    const tax = round(taxableInBracket * bracket.rate, 0);

    if (taxableInBracket > 0) {
      bracketDetails.push({
        bracket: i + 1,
        taxableInBracket,
        tax,
        rate: bracket.rate,
      });
    }

    totalTax += tax;
    remaining -= taxableInBracket;
    prevCeiling = bracket.ceiling === Infinity ? prevCeiling : bracket.ceiling;

    if (remaining <= 0) break;
  }

  const pitAmount = round(totalTax, 0);

  return {
    taxableIncome,
    pitAmount,
    effectiveRate: grossIncome > 0 ? round(pitAmount / grossIncome, 4) : 0,
    bracketDetails,
  };
}
