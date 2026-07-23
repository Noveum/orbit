import { describe, expect, test } from 'bun:test';

const css = await Bun.file(`${import.meta.dir}/globals.css`).text();

function declarations(selector: string, from = 0): Map<string, string> {
  const open = css.indexOf(`${selector} {`, from);
  const close = css.indexOf('}', open);
  const out = new Map<string, string>();
  if (open < 0 || close < 0) return out;
  for (const line of css.slice(open + selector.length + 2, close).split('\n')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (name !== undefined && value !== undefined) out.set(name, value.trim());
  }
  return out;
}

const light = declarations(':root');
const darkOverrides = declarations('.dark');
const compact = declarations('[data-density="compact"]');
const themeMap = declarations('@theme inline');
const dark = new Map([...light, ...darkOverrides]);

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function resolve(theme: Map<string, string>, token: string): string {
  const value = theme.get(token);
  if (value === undefined) throw new Error(`missing token ${token}`);
  if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error(`${token} is not a six digit hex: ${value}`);
  return value;
}

function contrast(theme: Map<string, string>, fg: string, bg: string): number {
  const a = luminance(resolve(theme, `--orbit-${fg}`));
  const b = luminance(resolve(theme, `--orbit-${bg}`));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const surfaces = ['bg', 'surface', 'surface-2', 'surface-3', 'hover', 'selected'] as const;
const textRoles = [
  'text-strong',
  'text',
  'secondary',
  'muted',
  'faint',
  'accent',
  'danger',
  'success',
  'warning',
  'link',
] as const;
const glyphRoles = [
  'priority-none',
  'priority-urgent',
  'priority-high',
  'priority-medium',
  'priority-low',
  'state-triage',
  'state-backlog',
  'state-unstarted',
  'state-started',
  'state-review',
  'state-completed',
  'state-canceled',
  'presence',
  'merged',
  'diff-add',
  'diff-del',
] as const;
const themes: readonly (readonly [string, Map<string, string>])[] = [
  ['light', light],
  ['dark', dark],
];

describe('token layer', () => {
  test('every theme mapping resolves to a defined palette token', () => {
    const dangling: string[] = [];
    for (const [name, value] of themeMap) {
      for (const reference of value.matchAll(/var\((--orbit-[a-z0-9-]+)\)/g)) {
        const token = reference[1];
        if (token !== undefined && !light.has(token)) dangling.push(`${name} -> ${token}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  test('the dark theme only overrides tokens the light theme defines', () => {
    expect([...darkOverrides.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  test('the compact density scale only overrides tokens the base density defines', () => {
    expect(compact.size).toBeGreaterThan(0);
    expect([...compact.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  test('text roles clear 4.5:1 on every surface in both themes', () => {
    const failures: string[] = [];
    for (const [name, theme] of themes) {
      for (const fg of textRoles) {
        for (const bg of surfaces) {
          const ratio = contrast(theme, fg, bg);
          if (ratio < 4.5) failures.push(`${name} ${fg} on ${bg} ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('paired foreground and fill tokens clear 4.5:1 in both themes', () => {
    const pairs = [
      ['accent', 'accent-soft'],
      ['danger', 'danger-soft'],
      ['accent-contrast', 'accent'],
      ['danger-contrast', 'danger'],
      ['tooltip-contrast', 'tooltip'],
      ['text', 'popover'],
      ['text', 'menu-row'],
      ['text', 'pill'],
      ['text', 'code'],
      ['muted', 'icon-pad'],
    ] as const;
    const failures: string[] = [];
    for (const [name, theme] of themes) {
      for (const [fg, bg] of pairs) {
        const ratio = contrast(theme, fg, bg);
        if (ratio < 4.5) failures.push(`${name} ${fg} on ${bg} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('status and priority glyphs clear 3:1 on the surfaces they sit on', () => {
    const failures: string[] = [];
    for (const [name, theme] of themes) {
      for (const fg of glyphRoles) {
        for (const bg of ['surface', 'surface-2', 'selected'] as const) {
          const ratio = contrast(theme, fg, bg);
          if (ratio < 3) failures.push(`${name} ${fg} on ${bg} ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('the type scale is fluid at every step and capped', () => {
    const steps = [...themeMap.keys()].filter(
      (name) => name.startsWith('--text-') && !name.slice(7).includes('--'),
    );
    expect(steps.length).toBeGreaterThan(5);
    for (const step of steps) {
      expect(themeMap.get(step)).toContain('var(--orbit-fluid)');
    }
    expect(light.get('--orbit-fluid')).toContain('clamp(');
    expect(css).toContain('font-size: 100%');
  });

  test('motion tokens stay inside the 80ms to 200ms budget and neutralise on request', () => {
    for (const token of ['instant', 'fast', 'base', 'slow'] as const) {
      const value = themeMap.get(`--duration-${token}`);
      expect(value).toMatch(/^\d+ms$/);
      const ms = Number.parseInt(value ?? '0', 10);
      expect(ms).toBeGreaterThanOrEqual(80);
      expect(ms).toBeLessThanOrEqual(200);
    }
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('--duration-fast: 0.01ms');
    expect(reduced).toContain('transition-duration: 0.01ms !important');
  });
});
