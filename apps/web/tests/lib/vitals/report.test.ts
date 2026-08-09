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

describe('the subparts that say where the time went', () => {
  it('carries the LCP breakdown, so a slow load can be attributed', () => {
    const report = toReport(
      {
        name: 'LCP',
        value: 7088,
        rating: 'poor',
        attribution: {
          timeToFirstByte: 1874,
          resourceLoadDelay: 120.4,
          resourceLoadDuration: 3200,
          elementRenderDelay: 1893.6,
          target: 'main > div.issue-row',
        },
      },
      '/my-issues',
    );

    expect(report?.parts).toEqual({
      timeToFirstByte: 1874,
      resourceLoadDelay: 120.4,
      resourceLoadDuration: 3200,
      elementRenderDelay: 1893.6,
    });
    expect(report?.target).toBe('main > div.issue-row');
  });

  it('carries the INP breakdown, which separates React work from paint', () => {
    const report = toReport(
      {
        name: 'INP',
        value: 1128,
        rating: 'poor',
        attribution: {
          interactionType: 'pointer',
          inputDelay: 40,
          processingDuration: 1020,
          presentationDelay: 68,
        },
      },
      '/standup',
    );

    expect(report?.parts).toEqual({
      inputDelay: 40,
      processingDuration: 1020,
      presentationDelay: 68,
    });
  });

  it('leaves parts off entirely when the browser reported none', () => {
    const report = toReport({ name: 'CLS', value: 0.02, rating: 'good' }, '/inbox');
    expect(report?.parts).toBeUndefined();
  });

  it('ignores a subpart that is not a real duration', () => {
    const report = toReport(
      {
        name: 'LCP',
        value: 900,
        rating: 'good',
        attribution: {
          timeToFirstByte: 200,
          resourceLoadDelay: -5,
          elementRenderDelay: Number.NaN,
        },
      },
      '/inbox',
    );

    expect(report?.parts).toEqual({ timeToFirstByte: 200 });
  });

  it('still passes the ingest schema with parts attached', () => {
    const report = toReport(
      { name: 'LCP', value: 900, rating: 'good', attribution: { timeToFirstByte: 200 } },
      '/inbox',
    );
    expect(() => webVitalSchema.parse(report)).not.toThrow();
  });
});

describe('which route a soft navigation metric belongs to', () => {
  it('uses the URL the metric happened on, not wherever the person is now', () => {
    const report = toReport(
      {
        name: 'LCP',
        value: 2200,
        rating: 'needs-improvement',
        navigationURL: 'https://orbit.noveum.ai/team/eng/board',
      },
      '/my-issues',
    );

    expect(report?.route).toBe('/team/[key]/board');
  });

  it('still reduces that URL to a pattern', () => {
    const report = toReport(
      { name: 'LCP', value: 900, rating: 'good', navigationURL: '/issue/ORB-3' },
      '/inbox',
    );

    expect(report?.route).toBe('/issue/[identifier]');
  });

  it('falls back to where the person is when the metric names no URL', () => {
    const report = toReport({ name: 'LCP', value: 900, rating: 'good' }, '/inbox');
    expect(report?.route).toBe('/inbox');
  });

  it('falls back rather than throwing on a URL it cannot read', () => {
    const report = toReport(
      { name: 'LCP', value: 900, rating: 'good', navigationURL: 'http://[' },
      '/inbox',
    );

    expect(report?.route).toBe('/inbox');
  });
});
