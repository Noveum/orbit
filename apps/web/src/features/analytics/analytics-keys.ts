import type {
  AnalyticsDrilldownQuery,
  AnalyticsLens,
  AnalyticsQuery,
} from '@orbit/shared/validators';
import { canonicalAnalyticsQuery, canonicalDrilldownQuery } from './query-state.ts';

export const ANALYTICS_ROOT = 'analytics';

export const analyticsKeys = {
  root: [ANALYTICS_ROOT] as const,
  lens: (lens: AnalyticsLens, query: AnalyticsQuery) =>
    [ANALYTICS_ROOT, 'lens', lens, canonicalAnalyticsQuery(query)] as const,
  drilldown: (query: AnalyticsDrilldownQuery) =>
    [ANALYTICS_ROOT, 'drilldown', canonicalDrilldownQuery(query)] as const,
} as const;
