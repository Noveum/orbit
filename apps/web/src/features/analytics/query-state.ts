import { validationFailed } from '@orbit/shared/errors';
import { encodeFilter, filterGroupSchema, isEmptyFilter } from '@orbit/shared/filters';
import {
  type AnalyticsDrilldownQuery,
  type AnalyticsInsightsQuery,
  type AnalyticsQuery,
  analyticsDrilldownQuerySchema,
  analyticsInsightsQuerySchema,
  analyticsQuerySchema,
  type InsightConfig,
  insightConfigSchema,
} from '@orbit/shared/validators';
import { z } from 'zod';

export type AnalyticsSearchParams =
  | URLSearchParams
  | Readonly<Record<string, string | string[] | undefined>>;

const defaultAnalyticsQuery = analyticsQuerySchema.parse({});
const defaultInsightConfig = insightConfigSchema.parse({});
const encodedFilterSchema = z
  .string()
  .transform((encoded, context): unknown => {
    try {
      return JSON.parse(encoded) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'The analytics filter is not valid JSON.' });
      return z.NEVER;
    }
  })
  .pipe(filterGroupSchema);

function parameterValue(params: AnalyticsSearchParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function booleanValue(value: string | undefined): boolean | string | undefined {
  if (value === undefined) return undefined;
  if (value === '1') return true;
  if (value === '0') return false;
  return value;
}

function rangeValue(params: AnalyticsSearchParams): unknown {
  const preset = parameterValue(params, 'range');
  if (preset === undefined) return undefined;
  if (preset !== 'custom') return { preset };
  return { preset, from: parameterValue(params, 'from'), to: parameterValue(params, 'to') };
}

function filterValue(params: AnalyticsSearchParams): unknown {
  const encoded = parameterValue(params, 'filter');
  if (encoded === undefined) return undefined;
  return encodedFilterSchema.parse(encoded);
}

function queryInput(params: AnalyticsSearchParams): unknown {
  const projectId = parameterValue(params, 'projectId');
  const personId = parameterValue(params, 'personId');
  return {
    version:
      parameterValue(params, 'version') === undefined
        ? undefined
        : Number(parameterValue(params, 'version')),
    lens: parameterValue(params, 'lens'),
    range: rangeValue(params),
    compare: parameterValue(params, 'compare'),
    measure: parameterValue(params, 'measure'),
    filter: filterValue(params),
    includeArchived: booleanValue(parameterValue(params, 'includeArchived')),
    includeCanceled: booleanValue(parameterValue(params, 'includeCanceled')),
    focus: projectId === undefined && personId === undefined ? undefined : { projectId, personId },
  };
}

export function parseAnalyticsSearchParamsStrict(params: AnalyticsSearchParams): AnalyticsQuery {
  return analyticsQuerySchema.parse(queryInput(params));
}

export function parseAnalyticsSearchParams(params: AnalyticsSearchParams): AnalyticsQuery {
  try {
    return parseAnalyticsSearchParamsStrict(params);
  } catch {
    return defaultAnalyticsQuery;
  }
}

export function analyticsDrilldownFromSearchParams(
  params: AnalyticsSearchParams,
): AnalyticsDrilldownQuery {
  const query = parseAnalyticsSearchParamsStrict(params);
  return analyticsDrilldownQuerySchema.parse({
    ...query,
    cohort: {
      cohort: parameterValue(params, 'cohort'),
      bucket: parameterValue(params, 'bucket'),
    },
    cursor: parameterValue(params, 'cursor'),
    limit: parameterValue(params, 'limit'),
  });
}

export function searchParamsForAnalytics(queryInputValue: AnalyticsQuery): URLSearchParams {
  const query = analyticsQuerySchema.parse(queryInputValue);
  const params = new URLSearchParams();
  if (query.lens !== defaultAnalyticsQuery.lens) params.set('lens', query.lens);
  if (query.range.preset !== defaultAnalyticsQuery.range.preset) {
    params.set('range', query.range.preset);
    if (query.range.preset === 'custom') {
      params.set('from', query.range.from);
      params.set('to', query.range.to);
    }
  }
  if (query.compare !== defaultAnalyticsQuery.compare) params.set('compare', query.compare);
  if (query.measure !== defaultAnalyticsQuery.measure) params.set('measure', query.measure);
  if (!isEmptyFilter(query.filter)) params.set('filter', encodeFilter(query.filter));
  if (query.includeArchived) params.set('includeArchived', '1');
  if (query.includeCanceled) params.set('includeCanceled', '1');
  if (query.focus.projectId !== undefined) params.set('projectId', query.focus.projectId);
  if (query.focus.personId !== undefined) params.set('personId', query.focus.personId);
  return params;
}

export function searchParamsForDrilldown(query: AnalyticsDrilldownQuery): URLSearchParams {
  const params = searchParamsForAnalytics(query);
  params.set('cohort', query.cohort.cohort);
  if (query.cohort.bucket !== undefined) params.set('bucket', query.cohort.bucket);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== 50) params.set('limit', String(query.limit));
  return params;
}

export function canonicalAnalyticsQuery(query: AnalyticsQuery): string {
  return searchParamsForAnalytics(query).toString();
}

export function canonicalDrilldownQuery(query: AnalyticsDrilldownQuery): string {
  return searchParamsForDrilldown(query).toString();
}

function insightConfigInput(params: AnalyticsSearchParams): unknown {
  return {
    measure: parameterValue(params, 'insightMeasure'),
    slice: parameterValue(params, 'insightSlice'),
    segment: parameterValue(params, 'insightSegment'),
    cumulative: booleanValue(parameterValue(params, 'insightCumulative')),
  };
}

export function insightConfigFromSearchParams(params: AnalyticsSearchParams): InsightConfig {
  try {
    return insightConfigSchema.parse(insightConfigInput(params));
  } catch {
    return defaultInsightConfig;
  }
}

export function searchParamsForInsightConfig(insight: InsightConfig): URLSearchParams {
  const parsed = insightConfigSchema.parse(insight);
  const params = new URLSearchParams();
  if (parsed.measure !== defaultInsightConfig.measure) params.set('insightMeasure', parsed.measure);
  if (parsed.slice !== defaultInsightConfig.slice) params.set('insightSlice', parsed.slice);
  if (parsed.segment !== undefined) params.set('insightSegment', parsed.segment);
  if (parsed.cumulative !== defaultInsightConfig.cumulative) {
    params.set('insightCumulative', parsed.cumulative ? '1' : '0');
  }
  return params;
}

export function analyticsInsightsFromSearchParams(
  params: AnalyticsSearchParams,
): AnalyticsInsightsQuery {
  const raw = parameterValue(params, 'query');
  let json: unknown;
  try {
    json = raw === undefined ? {} : JSON.parse(raw);
  } catch {
    throw validationFailed('That analytics insights query is not valid JSON.');
  }
  return analyticsInsightsQuerySchema.parse(json);
}

export function searchParamsForInsights(query: AnalyticsInsightsQuery): URLSearchParams {
  const parsed = analyticsInsightsQuerySchema.parse(query);
  const params = new URLSearchParams();
  params.set('query', JSON.stringify(parsed));
  return params;
}

export function canonicalInsightsQuery(query: AnalyticsInsightsQuery): string {
  return searchParamsForInsights(query).toString();
}

export function searchParamsForSavedAnalyticsView(
  query: AnalyticsQuery,
  insight: InsightConfig,
): URLSearchParams {
  const params = searchParamsForAnalytics(query);
  for (const [key, value] of searchParamsForInsightConfig(insight)) params.set(key, value);
  return params;
}

export function canonicalSavedAnalyticsView(query: AnalyticsQuery, insight: InsightConfig): string {
  return searchParamsForSavedAnalyticsView(query, insight).toString();
}
