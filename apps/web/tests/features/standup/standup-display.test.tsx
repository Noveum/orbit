import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_STANDUP_DISPLAY,
  isStandupDisplayModified,
  standupDisplayKey,
  useStandupDisplay,
} from '../../../src/features/standup/standup-display.tsx';

const userId = 'standup-display-test';
const otherUserId = 'standup-display-other';
const key = standupDisplayKey(userId);

afterEach(() => {
  window.localStorage.removeItem(key);
  window.localStorage.removeItem(standupDisplayKey(otherUserId));
});

describe('useStandupDisplay', () => {
  it('defaults to assigned work, every agent and the automatic member layout', () => {
    const { result } = renderHook(() => useStandupDisplay(userId));
    expect(result.current.loaded).toBe(true);
    expect(result.current.display).toEqual({
      memberLayout: 'auto',
      workType: 'assigned',
      aiOnly: false,
    });
    expect(isStandupDisplayModified(result.current.display)).toBe(false);
  });

  it('falls back field by field when the saved value is broken', () => {
    window.localStorage.setItem(key, 'not json');
    const first = renderHook(() => useStandupDisplay(userId));
    expect(first.result.current.display).toEqual(DEFAULT_STANDUP_DISPLAY);
    first.unmount();
    window.localStorage.setItem(key, JSON.stringify({ workType: 'nope', aiOnly: true }));
    const second = renderHook(() => useStandupDisplay(userId));
    expect(second.result.current.display).toEqual({ ...DEFAULT_STANDUP_DISPLAY, aiOnly: true });
  });

  it('remembers every choice across mounts', () => {
    const first = renderHook(() => useStandupDisplay(userId));
    act(() => first.result.current.update({ workType: 'all' }));
    act(() => first.result.current.update({ aiOnly: true }));
    act(() => first.result.current.update({ memberLayout: 'dropdown' }));
    first.unmount();
    const second = renderHook(() => useStandupDisplay(userId));
    expect(second.result.current.display).toEqual({
      memberLayout: 'dropdown',
      workType: 'all',
      aiOnly: true,
    });
    expect(isStandupDisplayModified(second.result.current.display)).toBe(true);
  });

  it('keeps each account preference separate', () => {
    window.localStorage.setItem(key, JSON.stringify({ workType: 'reviewing' }));
    const { result, rerender } = renderHook(({ id }) => useStandupDisplay(id), {
      initialProps: { id: userId },
    });
    expect(result.current.display.workType).toBe('reviewing');
    rerender({ id: otherUserId });
    expect(result.current.display.workType).toBe('assigned');
    rerender({ id: userId });
    expect(result.current.display.workType).toBe('reviewing');
  });
});
