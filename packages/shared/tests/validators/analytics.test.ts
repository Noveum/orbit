import { describe, expect, it } from 'bun:test';
import { analyticsQuerySchema } from '../../src/validators/analytics.ts';

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
});
