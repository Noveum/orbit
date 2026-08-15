import { describe, expect, it } from 'bun:test';
import { analyticsQuerySchema, insightConfigSchema } from '@orbit/shared/validators';
import { analyticsKeys } from '../../../src/features/analytics/analytics-keys.ts';
import {
  canonicalAnalyticsQuery,
  insightConfigFromSearchParams,
  parseAnalyticsSearchParams,
  searchParamsForAnalytics,
  searchParamsForInsightConfig,
} from '../../../src/features/analytics/query-state.ts';

const defaults = analyticsQuerySchema.parse({});
const defaultInsight = insightConfigSchema.parse({});

describe('analytics URL state', () => {
  it('keeps the zero-configuration defaults out of the URL', () => {
    expect(searchParamsForAnalytics(defaults).toString()).toBe('');
    expect(parseAnalyticsSearchParams(new URLSearchParams())).toEqual(defaults);
  });

  it('round trips a custom range, nested filters, inclusions, and focus', () => {
    const query = analyticsQuerySchema.parse({
      lens: 'projects',
      range: { preset: 'custom', from: '2026-07-01', to: '2026-08-12' },
      compare: 'previous_period',
      measure: 'points',
      includeArchived: true,
      includeCanceled: true,
      focus: { projectId: 'project-platform', personId: 'person-ada' },
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'project',
            operator: 'in',
            values: ['project-platform', 'none'],
            negate: false,
          },
          {
            kind: 'group',
            combinator: 'or',
            children: [
              {
                kind: 'condition',
                property: 'stateAge',
                operator: 'relative',
                relative: { unit: 'week', offset: 2, direction: 'past' },
                negate: false,
              },
              {
                kind: 'condition',
                property: 'priority',
                operator: 'range',
                from: '1',
                to: '3',
                negate: true,
              },
            ],
          },
        ],
      },
    });

    const encoded = searchParamsForAnalytics(query);

    expect(encoded.get('range')).toBe('custom');
    expect(encoded.get('from')).toBe('2026-07-01');
    expect(encoded.get('to')).toBe('2026-08-12');
    expect(parseAnalyticsSearchParams(encoded)).toEqual(query);
  });

  it('falls back atomically when the URL contains an invalid custom range', () => {
    const parsed = parseAnalyticsSearchParams(
      new URLSearchParams('lens=people&range=custom&from=2026-08-12&to=2026-08-01'),
    );

    expect(parsed).toEqual(defaults);
  });

  it('canonicalizes equivalent object input before using it in cache keys', () => {
    const fromUrl = parseAnalyticsSearchParams(new URLSearchParams('lens=people'));
    const fromObject = analyticsQuerySchema.parse({ lens: 'people' });

    expect(canonicalAnalyticsQuery(fromUrl)).toEqual(canonicalAnalyticsQuery(fromObject));
    expect(analyticsKeys.lens('people', fromUrl)).toEqual(analyticsKeys.lens('people', fromObject));
    expect(analyticsKeys.root).toEqual(['analytics']);
  });

  it('keeps the default insight config out of the URL', () => {
    expect(searchParamsForInsightConfig(defaultInsight).toString()).toBe('');
    expect(insightConfigFromSearchParams(new URLSearchParams())).toEqual(defaultInsight);
  });

  it('round trips a non-default insight config through flat params', () => {
    const insight = insightConfigSchema.parse({
      measure: 'points',
      slice: 'assignee',
      segment: 'state',
      cumulative: false,
    });

    const encoded = searchParamsForInsightConfig(insight);

    expect(encoded.get('insightMeasure')).toBe('points');
    expect(encoded.get('insightSlice')).toBe('assignee');
    expect(encoded.get('insightSegment')).toBe('state');
    expect(encoded.get('insightCumulative')).toBeNull();
    expect(insightConfigFromSearchParams(encoded)).toEqual(insight);
  });

  it('round trips cumulative on a week slice', () => {
    const insight = insightConfigSchema.parse({ slice: 'completed_week', cumulative: true });

    const encoded = searchParamsForInsightConfig(insight);

    expect(encoded.get('insightCumulative')).toBe('1');
    expect(insightConfigFromSearchParams(encoded)).toEqual(insight);
  });

  it('falls back to the default insight config when the URL value is malformed', () => {
    const parsed = insightConfigFromSearchParams(
      new URLSearchParams('insightMeasure=not-a-measure'),
    );

    expect(parsed).toEqual(defaultInsight);
  });
});
