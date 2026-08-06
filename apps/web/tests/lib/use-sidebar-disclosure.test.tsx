import { beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useSidebarDisclosure } from '@/lib/use-sidebar-disclosure.ts';

const STORAGE_KEY = 'orbit:sidebar:disclosure';

beforeEach(() => {
  window.localStorage.clear();
});

describe('the remembered disclosure state', () => {
  it('writes a closed section to storage and reads it back on the next mount', () => {
    const first = renderHook(() => useSidebarDisclosure());
    act(() => first.result.current.toggle('docs:group:private', true));

    expect(first.result.current.isOpen('docs:group:private', true)).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      'docs:group:private': false,
    });

    first.unmount();
    const second = renderHook(() => useSidebarDisclosure());

    expect(second.result.current.isOpen('docs:group:private', true)).toBe(false);
    expect(second.result.current.isOpen('docs:group:other', true)).toBe(true);
  });

  it('opens a whole chain at once so a hidden row can be revealed', () => {
    const view = renderHook(() => useSidebarDisclosure());
    act(() => view.result.current.toggle('docs:page:root', true));
    act(() => view.result.current.toggle('docs:page:child', true));
    act(() => view.result.current.toggle('docs:page:elsewhere', true));

    act(() => view.result.current.openAll(['docs:page:root', 'docs:page:child']));

    expect(view.result.current.isOpen('docs:page:root', true)).toBe(true);
    expect(view.result.current.isOpen('docs:page:child', true)).toBe(true);
    expect(view.result.current.isOpen('docs:page:elsewhere', true)).toBe(false);
  });

  it('ignores junk left in storage rather than throwing', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"a":1,"b":true,');
    const view = renderHook(() => useSidebarDisclosure());

    expect(view.result.current.isOpen('a', true)).toBe(true);
  });
});
