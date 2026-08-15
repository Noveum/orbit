import { describe, expect, it } from 'bun:test';
import {
  analyticsInsightsQuerySchema,
  analyticsQuerySchema,
  insightConfigSchema,
} from '../../src/validators/analytics.ts';

describe('analyticsQuerySchema', () => {
  it('fills the clean URL defaults', () => {
    expect(analyticsQuerySchema.parse({})).toMatchObject({
      version: 1,
      lens: 'overview',
      range: { preset: 'auto' },
      compare: 'auto',
      measure: 'issues',
      includeArchived: false,
      includeCanceled: false,
    });
  });

  it('rejects a reversed custom range', () => {
    expect(() =>
      analyticsQuerySchema.parse({
        range: { preset: 'custom', from: '2026-08-11', to: '2026-08-01' },
      }),
    ).toThrow();
  });

  it('accepts insights as a valid lens', () => {
    expect(analyticsQuerySchema.parse({ lens: 'insights' })).toMatchObject({ lens: 'insights' });
  });
});

describe('insightConfigSchema', () => {
  it('fills the insight defaults', () => {
    expect(insightConfigSchema.parse({})).toMatchObject({
      measure: 'count',
      slice: 'state_category',
      cumulative: false,
    });
  });

  it('rejects a segment equal to the slice', () => {
    expect(() => insightConfigSchema.parse({ slice: 'assignee', segment: 'assignee' })).toThrow();
  });

  it('rejects a segment equal to the defaulted slice when slice is omitted', () => {
    expect(() => insightConfigSchema.parse({ segment: 'state_category' })).toThrow();
  });

  it('allows a segment that differs from the slice', () => {
    expect(insightConfigSchema.parse({ slice: 'assignee', segment: 'project' })).toMatchObject({
      slice: 'assignee',
      segment: 'project',
    });
  });
});

describe('analyticsInsightsQuerySchema', () => {
  it('fills the insight query defaults when the insight object is present', () => {
    expect(analyticsInsightsQuerySchema.parse({ insight: {} })).toMatchObject({
      version: 1,
      lens: 'overview',
      insight: {
        measure: 'count',
        slice: 'state_category',
        cumulative: false,
      },
    });
  });

  it('fills the insight query defaults when the insight key is omitted entirely', () => {
    expect(analyticsInsightsQuerySchema.parse({})).toMatchObject({
      version: 1,
      lens: 'overview',
      insight: {
        measure: 'count',
        slice: 'state_category',
        cumulative: false,
      },
    });
  });
});
