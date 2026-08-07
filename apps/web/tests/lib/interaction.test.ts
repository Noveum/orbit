import { describe, expect, it } from 'bun:test';
import * as interaction from '@/lib/interaction.ts';

const ALLOWED_TRANSITIONS = ['transition-opacity', 'transition-colors', 'transition-transform'];

const REFLOWING_TRANSITIONS = [
  'transition-all',
  'transition-[width]',
  'transition-[height]',
  'transition-[margin]',
  'transition-[padding]',
  'transition-[top]',
  'transition-[left]',
];

function tokens(): [string, string][] {
  return Object.entries(interaction).flatMap(([name, value]) =>
    typeof value === 'string' ? [[name, value] as [string, string]] : [],
  );
}

function transitioning(): [string, string][] {
  return tokens().filter(([, value]) => value.includes('transition-'));
}

describe('the shared interaction tokens', () => {
  it('reads every export as a class string, so nothing escapes the audit', () => {
    expect(tokens().length).toBe(Object.keys(interaction).length);
    expect(transitioning().length).toBeGreaterThan(0);
  });

  it('gives every transition an escape for a viewer who asked for less motion', () => {
    for (const [name, value] of transitioning()) {
      expect([name, value.includes('motion-reduce:transition-none')]).toEqual([name, true]);
    }
  });

  it('transitions opacity, colour and transform only, never a property that reflows', () => {
    for (const [name, value] of transitioning()) {
      const declared = value
        .split(' ')
        .filter((part) => part.startsWith('transition-') && part !== 'transition-none');
      const stray = declared.filter((part) => !ALLOWED_TRANSITIONS.includes(part));
      expect([name, stray]).toEqual([name, []]);
    }
  });

  it('names no reflowing property, whatever the allow list grows to hold', () => {
    for (const banned of REFLOWING_TRANSITIONS) {
      expect([banned, ALLOWED_TRANSITIONS.includes(banned)]).toEqual([banned, false]);
    }
    for (const [name, value] of tokens()) {
      const reflowing = REFLOWING_TRANSITIONS.filter((banned) => value.includes(banned));
      expect([name, reflowing]).toEqual([name, []]);
    }
  });

  it('keeps every transition on the shared duration scale', () => {
    for (const [name, value] of transitioning()) {
      const onScale = /duration-\[var\(--duration-(instant|fast|base)\)\]/.test(value);
      expect([name, onScale]).toEqual([name, true]);
    }
  });

  it('holds a danger affordance red through hover and through menu highlight', () => {
    expect(interaction.dangerAction).toContain('hover:text-danger');
    expect(interaction.dangerMenuAction).toContain('data-[highlighted]:text-danger');
  });
});
