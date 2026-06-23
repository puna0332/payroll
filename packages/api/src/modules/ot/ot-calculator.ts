/**
 * OT Calculator — Main orchestrator for OT calculation per approval/session
 *
 * Flow: resolve day type → split segments → classify buckets → calculate amounts
 */

import { PrismaClient } from '@prisma/client';
import { roundUp, round } from '../../shared/utils/round.js';
import { DAILY_OT_LIMIT } from '../../config/constants.js';
import { resolveDayType, type OtDayKind, type ScheduleType } from './day-type.js';
import { splitIntoSegments } from './time-segments.js';
import { classifySegment } from './bucket-classifier.js';

const MODULE = '[OT:Calculator]';

// ─── Types ──────────────────────────────────────────────────

export interface OtCalculationInput {
  employeeId: string;
  periodId: string;
  approvalId: string;
  workDate: Date;
  startTime: Date;
  endTime: Date;
  scheduleType: ScheduleType;
  hourlyRate: number;
}

export interface OtDetailResult {
  bucket: string;
  bucketKey: string;
  rate: number;
  hours: number;
  validHours: number;
  amount: number;
  dayType: string;
  startTime: Date;
  endTime: Date;
}

export interface OtCalculationResult {
  details: OtDetailResult[];
  totalHours: number;
  totalAmount: number;
  exceedsDailyLimit: boolean;
}

// ─── Main Functions ─────────────────────────────────────────

/**
 * Calculate OT for a single approval/work session (async — fetches calendar).
 */
export async function calculateOt(
  input: OtCalculationInput,
  prisma: PrismaClient,
): Promise<OtCalculationResult> {
  const dayKind = await resolveDayType(input.workDate, input.scheduleType, prisma);
  return calculateOtSync(input, dayKind);
}

/**
 * Calculate OT with pre-resolved day kind (no DB access).
 */
export function calculateOtSync(
  input: Omit<OtCalculationInput, 'scheduleType'>,
  dayKind: OtDayKind,
): OtCalculationResult {
  const { startTime, endTime, hourlyRate } = input;

  // 1. Split into day/night segments
  const segments = splitIntoSegments(startTime, endTime);

  // 2. Classify each segment and calculate amounts
  const details: OtDetailResult[] = [];

  for (const segment of segments) {
    const classified = classifySegment(segment, dayKind);

    for (const cs of classified) {
      const amount = roundUp(cs.segment.hours * cs.rate * hourlyRate, 0);

      details.push({
        bucket: cs.label,
        bucketKey: cs.bucketKey,
        rate: cs.rate,
        hours: round(cs.segment.hours, 2),
        validHours: round(cs.segment.hours, 2), // validHours = hours (no cap applied)
        amount,
        dayType: dayKind,
        startTime: cs.segment.start,
        endTime: cs.segment.end,
      });
    }
  }

  // 3. Totals (exclude night_normal 30% from totalHours to avoid double-counting)
  const mainDetails = details.filter(d => d.bucketKey !== 'night_normal');
  const totalHours = round(mainDetails.reduce((sum, d) => sum + d.hours, 0), 2);
  const totalAmount = details.reduce((sum, d) => sum + d.amount, 0);

  // 4. Daily limit check (flag only, don't cap)
  const exceedsDailyLimit = totalHours > DAILY_OT_LIMIT;
  if (exceedsDailyLimit) {
    console.warn(`${MODULE} Daily OT limit exceeded: ${totalHours}h > ${DAILY_OT_LIMIT}h on ${input.workDate.toISOString().split('T')[0]}`);
  }

  console.log(`${MODULE} ${dayKind} | ${totalHours}h | ${totalAmount.toLocaleString()} VND | ${details.length} entries`);

  return { details, totalHours, totalAmount, exceedsDailyLimit };
}
