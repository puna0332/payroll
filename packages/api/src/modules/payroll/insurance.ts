/**
 * Insurance Calculator — BHXH, BHYT, BHTN
 * Caps: BHXH+BHYT basis ≤ 46.8M, BHTN basis ≤ 99.2M
 */

import { round } from '../../shared/utils/round.js';
import { INSURANCE_RATES, INSURANCE_CAPS } from '../../config/constants.js';

// ─── Types ──────────────────────────────────────────────────

export interface InsuranceCaps {
  bhxhBhyt: number;
  bhtn: number;
}

export interface InsurancePart {
  bhxh: number;
  bhyt: number;
  bhtn: number;
  total: number;
}

export interface InsuranceResult {
  insuranceBasis: number;
  basisBhxhBhyt: number;
  basisBhtn: number;
  caps: InsuranceCaps;
  employee: InsurancePart;
  employer: InsurancePart;
  grandTotal: number;
}

// ─── Zero Result ────────────────────────────────────────────

const DEFAULT_CAPS: InsuranceCaps = {
  bhxhBhyt: INSURANCE_CAPS.bhxh_bhyt,
  bhtn: INSURANCE_CAPS.bhtn,
};

const ZERO_PART: InsurancePart = { bhxh: 0, bhyt: 0, bhtn: 0, total: 0 };

function normalizeCaps(caps?: Partial<InsuranceCaps>): InsuranceCaps {
  const bhxhBhyt = Number(caps?.bhxhBhyt ?? DEFAULT_CAPS.bhxhBhyt);
  const bhtn = Number(caps?.bhtn ?? DEFAULT_CAPS.bhtn);
  return {
    bhxhBhyt: Number.isFinite(bhxhBhyt) && bhxhBhyt > 0 ? bhxhBhyt : DEFAULT_CAPS.bhxhBhyt,
    bhtn: Number.isFinite(bhtn) && bhtn > 0 ? bhtn : DEFAULT_CAPS.bhtn,
  };
}

function zeroResult(insuranceBasis = 0, caps?: Partial<InsuranceCaps>): InsuranceResult {
  return {
    insuranceBasis,
    basisBhxhBhyt: 0,
    basisBhtn: 0,
    caps: normalizeCaps(caps),
    employee: { ...ZERO_PART },
    employer: { ...ZERO_PART },
    grandTotal: 0,
  };
}

// ─── Main Function ──────────────────────────────────────────

/**
 * Calculate insurance for an employee.
 *
 * @param insuranceBasis — Salary basis (usually baseSalary from policy)
 * @param employmentType — P (Part-time/Probation), M (Freelance), FT (Full-time)
 * @returns Insurance breakdown for employee and employer
 *
 * Exceptions:
 * - P/M types: NO insurance
 * - If basis = 0: all zeros
 */
export function calculateInsurance(
  insuranceBasis: number,
  employmentType?: string,
  caps?: Partial<InsuranceCaps>,
): InsuranceResult {
  const resolvedCaps = normalizeCaps(caps);

  // No insurance for P-type (probation/part-time) and M-type (freelance)
  if (employmentType === 'P' || employmentType === 'M') {
    return zeroResult(insuranceBasis, resolvedCaps);
  }

  if (insuranceBasis <= 0) {
    return zeroResult(0, resolvedCaps);
  }

  // Cap bases
  const basisBhxhBhyt = Math.min(insuranceBasis, resolvedCaps.bhxhBhyt);
  const basisBhtn = Math.min(insuranceBasis, resolvedCaps.bhtn);

  // Employee
  const empBhxh = round(basisBhxhBhyt * INSURANCE_RATES.employee.bhxh, 0);
  const empBhyt = round(basisBhxhBhyt * INSURANCE_RATES.employee.bhyt, 0);
  const empBhtn = round(basisBhtn * INSURANCE_RATES.employee.bhtn, 0);
  const empTotal = empBhxh + empBhyt + empBhtn;

  // Employer
  const erBhxh = round(basisBhxhBhyt * INSURANCE_RATES.employer.bhxh, 0);
  const erBhyt = round(basisBhxhBhyt * INSURANCE_RATES.employer.bhyt, 0);
  const erBhtn = round(basisBhtn * INSURANCE_RATES.employer.bhtn, 0);
  const erTotal = erBhxh + erBhyt + erBhtn;

  return {
    insuranceBasis,
    basisBhxhBhyt,
    basisBhtn,
    caps: resolvedCaps,
    employee: { bhxh: empBhxh, bhyt: empBhyt, bhtn: empBhtn, total: empTotal },
    employer: { bhxh: erBhxh, bhyt: erBhyt, bhtn: erBhtn, total: erTotal },
    grandTotal: empTotal + erTotal,
  };
}
