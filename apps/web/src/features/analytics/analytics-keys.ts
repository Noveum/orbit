import type {
  AnalyticsDrilldownQuery,
  AnalyticsInsightsQuery,
  AnalyticsLens,
  AnalyticsQuery,
} from '@orbit/shared/validators';
import {
  canonicalAnalyticsQuery,
  canonicalDrilldownQuery,
  canonicalInsightsQuery,
} from './query-state.ts';

export const ANALYTICS_ROOT = 'analytics';

export const analyticsKeys = {
  root: [ANALYTICS_ROOT] as const,
  lens: (lens: AnalyticsLens, query: AnalyticsQuery) =>
    [ANALYTICS_ROOT, 'lens', lens, canonicalAnalyticsQuery(query)] as const,
  drilldown: (query: AnalyticsDrilldownQuery) =>
    [ANALYTICS_ROOT, 'drilldown', canonicalDrilldownQuery(query)] as const,
  insights: (input: AnalyticsInsightsQuery) =>
    [ANALYTICS_ROOT, 'insights', canonicalInsightsQuery(input)] as const,
} as const;
