import type { AnalyticsDrilldownCohort, AnalyticsQuery, AnalyticsRange } from '@orbit/shared';

export type AnalyticsBucketGranularity = 'day' | 'week' | 'month';
export type AnalyticsMetricUnit = 'issues' | 'points' | 'days' | 'percent';

export interface AnalyticsDateRange {
  readonly from: Date;
  readonly to: Date;
  readonly timezone: string;
}

export interface AnalyticsCoverage {
  readonly kind: 'live' | 'observed' | 'reconstructed' | 'frozen';
  readonly from: string | null;
  readonly asOf: string;
}

export interface AnalyticsMetric {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: AnalyticsMetricUnit;
  readonly comparisonDelta: number | null;
  readonly cohort: AnalyticsDrilldownCohort;
}

export interface AnalyticsBucket {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: AnalyticsMetricUnit;
  readonly cohort: AnalyticsDrilldownCohort;
}

export interface AnalyticsFreshness {
  readonly kind: 'live' | 'updated' | 'snapshot';
  readonly at: string;
}

export interface AnalyticsSprint {
  readonly id: string;
  readonly teamId: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly completedAt: Date | null;
  readonly archivedAt?: Date | null;
}

export interface AnalyticsResolutionContext {
  readonly now: Date;
  readonly timezone: string;
  readonly cycles: readonly AnalyticsSprint[];
  readonly earliestIssueAt?: Date | null;
  readonly allTimeFrom?: Date | null;
}

export interface ResolvedAnalyticsQuery extends Omit<AnalyticsQuery, 'range'> {
  readonly requestedRange: AnalyticsRange;
  readonly range: AnalyticsDateRange;
  readonly comparisonRange: AnalyticsDateRange | null;
  readonly from: Date;
  readonly to: Date;
  readonly comparisonFrom: Date | null;
  readonly comparisonTo: Date | null;
  readonly bucket: AnalyticsBucketGranularity;
  readonly timezone: string;
  readonly selectedSprintId: string | null;
}
