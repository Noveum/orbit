import { describe, expect, it } from 'bun:test';
import {
  analyticsOverviewResponseSchema,
  analyticsWireResponse,
} from '../../../src/features/analytics/contracts.ts';

const emptyOverview = {
  lens: 'overview',
  asOf: '2026-08-13T12:00:00.000Z',
  coverage: { kind: 'live', from: null, asOf: '2026-08-13T12:00:00.000Z' },
  cards: [],
  delivery: [],
  state: [],
  projects: [],
  priorities: [],
  outliers: [],
};

describe('analytics wire contracts', () => {
  it('rejects a Date before it can reach a client cache', () => {
    expect(() =>
      analyticsOverviewResponseSchema.parse({
        ...emptyOverview,
        asOf: new Date(emptyOverview.asOf),
      }),
    ).toThrow();
  });

  it('turns server values into the JSON-safe contract for the selected lens', () => {
    const result = analyticsWireResponse('overview', {
      ...emptyOverview,
      lens: 'overview',
      asOf: new Date(emptyOverview.asOf),
    });

    expect(result.lens).toBe('overview');
    expect(result.cards).toEqual([]);
    expect(typeof result.asOf).toBe('string');
  });

  it('rejects a payload from a different lens', () => {
    expect(() =>
      analyticsWireResponse('projects', { ...emptyOverview, lens: 'overview' }),
    ).toThrow();
  });
});
