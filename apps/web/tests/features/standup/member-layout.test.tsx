import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useMemberLayout } from '../../../src/features/standup/member-layout.tsx';

const userId = 'member-layout-test';
const otherUserId = 'member-layout-other';
const key = `orbit.standup.member-layout.${userId}`;

afterEach(() => {
  window.localStorage.removeItem(key);
  window.localStorage.removeItem(`orbit.standup.member-layout.${otherUserId}`);
});

describe('useMemberLayout', () => {
  it('defaults to cards with no saved preference or an invalid value', () => {
    const first = renderHook(() => useMemberLayout(userId));
    expect(first.result.current[0]).toBe('cards');
    first.unmount();
    window.localStorage.setItem(key, 'unknown');
    const second = renderHook(() => useMemberLayout(userId));
    expect(second.result.current[0]).toBe('cards');
  });

  it('remembers the selected layout across mounts', () => {
    const first = renderHook(() => useMemberLayout(userId));
    act(() => first.result.current[1]('dropdown'));
    expect(window.localStorage.getItem(key)).toBe('dropdown');
    first.unmount();
    const second = renderHook(() => useMemberLayout(userId));
    expect(second.result.current[0]).toBe('dropdown');
  });

  it('keeps each account preference separate', () => {
    window.localStorage.setItem(key, 'dropdown');
    const { result, rerender } = renderHook(({ id }) => useMemberLayout(id), {
      initialProps: { id: userId },
    });
    expect(result.current[0]).toBe('dropdown');
    rerender({ id: otherUserId });
    expect(result.current[0]).toBe('cards');
    rerender({ id: userId });
    expect(result.current[0]).toBe('dropdown');
  });
});
