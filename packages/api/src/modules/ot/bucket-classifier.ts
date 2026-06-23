/**
 * OT Bucket Classifier — Phân loại segment vào 1 trong 9 bucket OT
 *
 * Logic matrix:
 * | Day Kind  | Day (06-22)       | Night (22-06)        |
 * |-----------|-------------------|----------------------|
 * | weekday   | weekday_day 150%  | weekday_night 200%   |
 * | saturday  | saturday_day 150% | saturday_night 200%  |
 * | sunday    | sunday_day 200%   | sunday_night 270%    |
 * | holiday   | holiday_day 300%  | holiday_night 390%   |
 *
 * Night segments also get night_normal 30% as additional premium
 */

import { OT_BUCKETS, type OtBucketKey } from '../../config/constants.js';
import type { OtDayKind } from './day-type.js';
import type { TimeSegment } from './time-segments.js';

// ─── Types ──────────────────────────────────────────────────

export interface ClassifiedSegment {
  segment: TimeSegment;
  bucketKey: OtBucketKey;
  rate: number;
  label: string;
}

// ─── Lookup Map ─────────────────────────────────────────────

/** Build a map from OT_BUCKETS for quick lookup */
const BUCKET_MAP = new Map(OT_BUCKETS.map(b => [b.key, b]));

/** Day/night → bucket key matrix */
const BUCKET_MATRIX: Record<OtDayKind, { day: OtBucketKey; night: OtBucketKey }> = {
  weekday:  { day: 'weekday_day',  night: 'weekday_night' },
  saturday: { day: 'saturday_day', night: 'saturday_night' },
  sunday:   { day: 'sunday_day',   night: 'sunday_night' },
  holiday:  { day: 'holiday_day',  night: 'holiday_night' },
};

// ─── Main Function ──────────────────────────────────────────

/**
 * Classify a time segment into OT bucket(s).
 *
 * Night segments return 2 entries:
 * 1. The main bucket (e.g., weekday_night 200%)
 * 2. Night premium (night_normal 30%) — additive on top
 *
 * Day segments return 1 entry.
 *
 * @param segment — Time segment with isNight flag
 * @param dayKind — The day type (weekday/saturday/sunday/holiday)
 * @returns Array of classified segments (1 for day, 2 for night)
 */
export function classifySegment(
  segment: TimeSegment,
  dayKind: OtDayKind,
): ClassifiedSegment[] {
  const results: ClassifiedSegment[] = [];
  const frame = segment.isNight ? 'night' : 'day';
  const bucketKey = BUCKET_MATRIX[dayKind][frame];
  const bucket = BUCKET_MAP.get(bucketKey);

  if (!bucket) {
    throw new Error(`Unknown bucket key: ${bucketKey}`);
  }

  // Main bucket
  results.push({
    segment,
    bucketKey: bucket.key as OtBucketKey,
    rate: bucket.rate,
    label: bucket.label,
  });

  // Night premium: add 30% night allowance for any night segment
  if (segment.isNight) {
    const nightPremium = BUCKET_MAP.get('night_normal');
    if (nightPremium) {
      results.push({
        segment,
        bucketKey: nightPremium.key as OtBucketKey,
        rate: nightPremium.rate,
        label: nightPremium.label,
      });
    }
  }

  return results;
}

/**
 * Get bucket info by key
 */
export function getBucket(key: OtBucketKey) {
  return BUCKET_MAP.get(key);
}
