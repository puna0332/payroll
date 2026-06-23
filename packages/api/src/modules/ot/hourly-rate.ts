/**
 * OT Hourly Rate Calculator
 * Tính đơn giá giờ OT từ lương cơ bản
 */

import { STANDARD_HOURS } from '../../config/constants.js';
import { roundUp } from '../../shared/utils/round.js';

/**
 * Calculate hourly rate for OT.
 * Formula: baseSalary / standardDays / 8h
 * Uses roundUp to avoid underpaying employees
 */
export function calculateHourlyRate(baseSalary: number, standardDays: number): number {
  if (standardDays <= 0 || baseSalary <= 0) return 0;
  return roundUp(baseSalary / standardDays / STANDARD_HOURS, 0);
}

/**
 * Calculate unit rate for a specific OT bucket.
 * Formula: hourlyRate × bucketRate
 */
export function calculateUnitRate(hourlyRate: number, bucketRate: number): number {
  return roundUp(hourlyRate * bucketRate, 0);
}
