import type { Allowances } from './gross-income.js';

/**
 * Payroll-specific allowance policy.
 *
 * The Lark payroll template keeps management-dept and sales-team allowances
 * as explicit zero columns, so payslip calculation must not carry values from
 * the employee salary policy into these two buckets.
 */
export function normalizePayrollAllowances(allowances: Allowances): Allowances {
  return {
    ...allowances,
    bpql: 0,
    sales: 0,
  };
}
