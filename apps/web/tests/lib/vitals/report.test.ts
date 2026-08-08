import { describe, expect, it } from 'bun:test';
import { webVitalSchema } from '@orbit/shared/validators';
import { toReport } from '@/lib/vitals/report.ts';

describe('toReport', () => {
  it('keeps the interaction type, which is the dimension that matters here', () => {
    const report = toReport(
      {
        name: 'INP',
        value: 92.4,
        rating: 'good',
        navigationType: 'navigate',
        attribution: { interactionType: 'keyboard', interactionTarget: 'button#create' },
      },
      '/my-issues',
    );

    expect(report).toMatchObject({
      route: '/my-issues',
      metric: 'INP',
      rating: 'good',
      interactionType: 'keyboard',
      target: 'button#create',
    });
  });

  it('reduces the path to a route pattern rather than sending the identifier', () => {
    const report = toReport({ name: 'LCP', value: 1200, rating: 'good' }, '/issue/ORB-3');
    expect(report?.route).toBe('/issue/[identifier]');
  });

  it('survives a metric whose attribution carries no interaction at all', () => {
    const report = toReport(
      { name: 'TTFB', value: 210, rating: 'good', attribution: { waitingDuration: 12 } },
      '/inbox',
    );

    expect(report).not.toBeNull();
    expect(report?.interactionType ?? null).toBeNull();
    expect(report?.target ?? null).toBeNull();
  });

  it('drops an interaction type that is neither pointer nor keyboard', () => {
    const report = toReport(
      { name: 'INP', value: 40, rating: 'good', attribution: { interactionType: 'scroll' } },
      '/inbox',
    );

    expect(report?.interactionType ?? null).toBeNull();
  });

  it('refuses a metric that is not tracked, so FID cannot creep back in', () => {
    expect(toReport({ name: 'FID', value: 10, rating: 'good' }, '/inbox')).toBeNull();
  });

  it('refuses a value that could not have come from a real measurement', () => {
    expect(toReport({ name: 'LCP', value: Number.NaN, rating: 'good' }, '/inbox')).toBeNull();
    expect(toReport({ name: 'LCP', value: -5, rating: 'good' }, '/inbox')).toBeNull();
  });

  it('refuses a rating the schema would reject anyway', () => {
    expect(toReport({ name: 'LCP', value: 10, rating: 'excellent' }, '/inbox')).toBeNull();
  });

  it('emits something the ingest schema accepts, for every metric it tracks', () => {
    for (const name of ['CLS', 'INP', 'LCP', 'TTFB']) {
      const report = toReport({ name, value: 1.25, rating: 'good' }, '/team/eng/board');
      expect(() => webVitalSchema.parse(report)).not.toThrow();
    }
  });

  it('truncates a target long enough to break the column', () => {
    const report = toReport(
      {
        name: 'INP',
        value: 40,
        rating: 'good',
        attribution: { interactionType: 'pointer', interactionTarget: 'a'.repeat(500) },
      },
      '/inbox',
    );

    expect(report?.target?.length).toBe(256);
    expect(() => webVitalSchema.parse(report)).not.toThrow();
  });
});
