/**
 * Net Salary Calculator
 * net = gross − insurance − PIT + adjustments − union fee
 */

import { round } from '../../shared/utils/round.js';

export interface NetSalaryInput {
  grossIncome: number;
  insuranceEmployee: number;
  pitAmount: number;
  afterTaxAdjustment: number;
  unionFee: number;
}

/**
 * Calculate net salary.
 * Result rounded to nearest 100 VND and clamped to ≥ 0.
 */
export function calculateNetSalary(input: NetSalaryInput): number {
  const { grossIncome, insuranceEmployee, pitAmount, afterTaxAdjustment, unionFee } = input;

  const raw = grossIncome - insuranceEmployee - pitAmount + afterTaxAdjustment - unionFee;

  // Round to nearest 100 and clamp
  return Math.max(round(raw, -2), 0);
}
