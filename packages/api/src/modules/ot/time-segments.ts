/**
 * OT Time Segments — Split OT window into day/night segments
 * Night boundary: 22:00-06:00 (Vietnam labor law)
 */

import { round } from '../../shared/utils/round.js';

// ─── Types ──────────────────────────────────────────────────

export interface TimeSegment {
  /** Segment start time */
  start: Date;
  /** Segment end time */
  end: Date;
  /** Duration in hours */
  hours: number;
  /** True if segment falls within 22:00-06:00 */
  isNight: boolean;
}

// ─── Constants ──────────────────────────────────────────────

/** Night shift starts at 22:00 */
const NIGHT_START_HOUR = 22;
/** Night shift ends at 06:00 */
const NIGHT_END_HOUR = 6;

// ─── Functions ──────────────────────────────────────────────

/**
 * Check if a specific time is within the night window (22:00-06:00)
 *
 * @example
 * isNightTime(new Date('2026-05-29T23:00'))  // true
 * isNightTime(new Date('2026-05-29T05:30'))  // true
 * isNightTime(new Date('2026-05-29T10:00'))  // false
 */
export function isNightTime(date: Date): boolean {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * Find the next day/night boundary after the given time.
 * Boundaries are 06:00 and 22:00.
 */
function nextBoundary(from: Date): Date {
  const hour = from.getHours();
  const result = new Date(from);

  if (hour >= NIGHT_START_HOUR) {
    // Currently night (22-24) → next boundary is 06:00 next day
    result.setDate(result.getDate() + 1);
    result.setHours(NIGHT_END_HOUR, 0, 0, 0);
  } else if (hour < NIGHT_END_HOUR) {
    // Currently night (00-06) → next boundary is 06:00 same day
    result.setHours(NIGHT_END_HOUR, 0, 0, 0);
  } else {
    // Currently day (06-22) → next boundary is 22:00 same day
    result.setHours(NIGHT_START_HOUR, 0, 0, 0);
  }

  return result;
}

/**
 * Calculate hours between two Date objects.
 */
function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

/**
 * Split an OT time range into day/night segments.
 *
 * Splits at 06:00 and 22:00 boundaries.
 * Handles cross-midnight OT correctly.
 *
 * @example
 * // 17:00-01:00 splits into:
 * // [{ 17:00-22:00, 5h, day }, { 22:00-01:00, 3h, night }]
 *
 * @example
 * // 22:00-06:00 stays as:
 * // [{ 22:00-06:00, 8h, night }]
 */
export function splitIntoSegments(start: Date, end: Date): TimeSegment[] {
  if (end <= start) return [];

  const segments: TimeSegment[] = [];
  let cursor = new Date(start);

  // Safety: limit to prevent infinite loops (max 48h of OT is way beyond any real case)
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (cursor < end && iterations < MAX_ITERATIONS) {
    iterations++;
    const boundary = nextBoundary(cursor);
    const segEnd = boundary < end ? boundary : new Date(end);
    const hours = round(hoursBetween(cursor, segEnd), 2);

    if (hours > 0) {
      segments.push({
        start: new Date(cursor),
        end: new Date(segEnd),
        hours,
        isNight: isNightTime(cursor),
      });
    }

    cursor = segEnd;
  }

  return segments;
}
