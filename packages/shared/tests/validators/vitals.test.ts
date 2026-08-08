import { describe, expect, it } from 'bun:test';
import { routePattern, webVitalSchema } from '../../src/validators/vitals.ts';

describe('routePattern', () => {
  it('keeps a static route as it is', () => {
    expect(routePattern('/my-issues')).toBe('/my-issues');
    expect(routePattern('/inbox')).toBe('/inbox');
    expect(routePattern('/settings/general')).toBe('/settings/general');
  });

  it('collapses an issue identifier so one route is not thousands', () => {
    expect(routePattern('/issue/ORB-3')).toBe('/issue/[identifier]');
    expect(routePattern('/issue/NOVA-1284')).toBe('/issue/[identifier]');
  });

  it('collapses a team key and keeps the leaf', () => {
    expect(routePattern('/team/eng/board')).toBe('/team/[key]/board');
    expect(routePattern('/team/eng/issues')).toBe('/team/[key]/issues');
    expect(routePattern('/team/eng/sprint/12')).toBe('/team/[key]/sprint/[number]');
  });

  it('collapses opaque ids wherever they appear', () => {
    expect(routePattern('/doc/doc_01H8XK9')).toBe('/doc/[id]');
    expect(routePattern('/projects/orbit-relaunch')).toBe('/projects/[slug]');
    expect(routePattern('/views/view_01H8XK9ABCDE')).toBe('/views/[id]');
  });

  it('never lets a raw identifier through', () => {
    for (const path of [
      '/issue/ORB-3',
      '/doc/doc_01H8XK9ABCDE',
      '/views/8f14e45f-ceea-467a-9e6c-1e2b3c4d5e6f',
      '/team/eng/sprint/9',
    ]) {
      const pattern = routePattern(path);
      const raw = path.split('/').at(-1) ?? '';
      expect(pattern).not.toContain(raw);
    }
  });

  it('handles the root and a trailing slash', () => {
    expect(routePattern('/')).toBe('/');
    expect(routePattern('')).toBe('/');
    expect(routePattern('/inbox/')).toBe('/inbox');
  });
});

describe('webVitalSchema', () => {
  const good = {
    route: '/my-issues',
    metric: 'INP',
    value: 84,
    rating: 'good',
    navigationType: 'navigate',
    interactionType: 'keyboard',
    target: 'button.create-issue',
  };

  it('accepts a well formed report', () => {
    expect(webVitalSchema.parse(good)).toMatchObject({ metric: 'INP', value: 84 });
  });

  it('refuses a metric it does not track', () => {
    expect(() => webVitalSchema.parse({ ...good, metric: 'FID' })).toThrow();
  });

  it('refuses a negative or absurd value', () => {
    expect(() => webVitalSchema.parse({ ...good, value: -1 })).toThrow();
    expect(() => webVitalSchema.parse({ ...good, value: 10_000_000 })).toThrow();
    expect(() => webVitalSchema.parse({ ...good, value: Number.NaN })).toThrow();
  });

  it('refuses an interaction type outside the two that carry meaning', () => {
    expect(() => webVitalSchema.parse({ ...good, interactionType: 'scroll' })).toThrow();
  });

  it('allows the fields that are genuinely absent on a load metric', () => {
    const parsed = webVitalSchema.parse({
      route: '/login',
      metric: 'LCP',
      value: 1200,
      rating: 'good',
    });
    expect(parsed.navigationType).toBe('');
    expect(parsed.interactionType ?? null).toBeNull();
  });
});
