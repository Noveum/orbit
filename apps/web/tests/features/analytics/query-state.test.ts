import { describe, expect, it } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import { analyticsKeys } from '../../../src/features/analytics/analytics-keys.ts';
import {
  canonicalAnalyticsQuery,
  parseAnalyticsSearchParams,
  searchParamsForAnalytics,
} from '../../../src/features/analytics/query-state.ts';

const defaults = analyticsQuerySchema.parse({});

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
});
