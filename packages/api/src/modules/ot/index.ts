/**
 * OT Module — Barrel exports
 */

export { resolveDayType, resolveDayTypeSync, type OtDayKind, type ScheduleType } from './day-type.js';
export { splitIntoSegments, isNightTime, type TimeSegment } from './time-segments.js';
export { classifySegment, getBucket, type ClassifiedSegment } from './bucket-classifier.js';
export { calculateHourlyRate, calculateUnitRate } from './hourly-rate.js';
export { calculateOt, calculateOtSync, type OtCalculationInput, type OtCalculationResult, type OtDetailResult } from './ot-calculator.js';
export { aggregateOtMonthly, aggregateOtMonthlyBatch, type OtMonthlyResult } from './ot-ledger.js';
