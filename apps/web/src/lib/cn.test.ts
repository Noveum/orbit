import { describe, expect, it } from 'vitest';
import { cn } from './cn.ts';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('resolves conflicting tailwind utilities in favour of the last one', () => {
    expect(cn('px-2 text-muted', 'px-4')).toBe('text-muted px-4');
  });

  it('supports conditional object syntax and arrays', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b');
  });

  it('returns an empty string when nothing is passed', () => {
    expect(cn()).toBe('');
  });
});
