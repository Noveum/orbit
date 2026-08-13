import { encodeFilter, filterGroupSchema, isEmptyFilter } from '@orbit/shared/filters';
import {
  type AnalyticsDrilldownQuery,
  type AnalyticsQuery,
  analyticsDrilldownQuerySchema,
  analyticsQuerySchema,
} from '@orbit/shared/validators';
import { z } from 'zod';

export type AnalyticsSearchParams =
  | URLSearchParams
  | Readonly<Record<string, string | string[] | undefined>>;

const defaultAnalyticsQuery = analyticsQuerySchema.parse({});
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
