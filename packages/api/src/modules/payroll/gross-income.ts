/**
 * Gross Income Calculator
 * actualSalary + prorated allowances + OT - late deduction
 */

import { round } from '../../shared/utils/round.js';

// ─── Types ──────────────────────────────────────────────────

export interface Allowances {
  rank: number;
  bpql: number;
  sales: number;
  technical: number;
  language: number;
  housing: number;
  transport: number;
  meal: number;
  phone: number;
  attendance: number;
}

export interface GrossIncomeInput {
  baseSalary: number;
  actualDays: number;
  standardDays: number;
  allowances: Allowances;
  otTotalAmount: number;
  lateHours: number;
  earlyHours: number;
  hourlyRate: number;
}

export interface GrossIncomeResult {
  workRatio: number;
  actualSalary: number;
  proratedAllowances: number;
  phoneAllowance: number;
  lateDeduction: number;
  grossIncome: number;
}

// ─── Main Function ──────────────────────────────────────────

/**
 * Calculate gross income.
 *
 * 1. workRatio = actualDays / standardDays
 * 2. actualSalary = baseSalary × workRatio
 * 3. Allowances: all prorated according to the payroll template
 * 4. lateDeduction = early/late hours × monthly income hourly basis
 * 5. gross = actualSalary + allowances + OT − lateDeduction
 */
export function calculateGrossIncome(input: GrossIncomeInput): GrossIncomeResult {
  const { baseSalary, actualDays, standardDays, allowances, otTotalAmount, lateHours, earlyHours, hourlyRate } = input;

  // Work ratio (4 decimal precision)
  const workRatio = standardDays > 0 ? round(actualDays / standardDays, 4) : 0;

  // Actual salary
  const actualSalary = round(baseSalary * workRatio, 0);

  // Prorated allowances per Payroll 4.2026 template.
  const proratedValues = [
    round(allowances.rank * workRatio, 0),
    round(allowances.bpql * workRatio, 0),
    round(allowances.sales * workRatio, 0),
    round(allowances.technical * workRatio, 0),
    round(allowances.language * workRatio, 0),
    round(allowances.housing * workRatio, 0),
    round(allowances.transport * workRatio, 0),
    round(allowances.meal * workRatio, 0),
    round(allowances.phone * workRatio, 0),
    round(allowances.attendance * workRatio, 0),
  ];

  const proratedAllowances = proratedValues.reduce((sum, v) => sum + v, 0);
  const phoneAllowance = round(allowances.phone * workRatio, 0);

  const monthlyIncome = baseSalary + Object.values(allowances).reduce((sum, value) => sum + value, 0);
  const payrollHourlyRate = standardDays > 0 ? monthlyIncome / standardDays / 8 : hourlyRate;
  const lateDeduction = round((lateHours + earlyHours) * payrollHourlyRate, 0);

  // Gross income = salary + allowances + phone + OT − deduction
  const grossIncome = Math.max(0,
    actualSalary + proratedAllowances + otTotalAmount - lateDeduction,
  );

  return {
    workRatio,
    actualSalary,
    proratedAllowances: proratedAllowances + phoneAllowance,
    phoneAllowance,
    lateDeduction,
    grossIncome,
  };
}
