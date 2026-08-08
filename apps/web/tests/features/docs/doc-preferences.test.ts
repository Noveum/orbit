import { beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_DOC_PREFERENCES,
  DOC_PREFERENCES_STORAGE_KEY,
  parsePreferences,
  READING_WIDTH_CLASS,
  resetDocPreferences,
  useDocPreferences,
} from '@/features/docs/use-doc-preferences.ts';

describe('doc preferences', () => {
  it('opens a document rendered, with the formatting bar out of the way', () => {
    expect(DEFAULT_DOC_PREFERENCES.mode).toBe('rich');
    expect(DEFAULT_DOC_PREFERENCES.toolbar).toBe(false);
  });

  it('gives a document more room than the old fixed measure by default', () => {
    expect(READING_WIDTH_CLASS[DEFAULT_DOC_PREFERENCES.width]).toBe('max-w-[68rem]');
    expect(READING_WIDTH_CLASS.comfortable).toBe('max-w-[45rem]');
    expect(READING_WIDTH_CLASS.full).toBe('max-w-none');
  });

  it('keeps what was stored', () => {
    expect(parsePreferences({ mode: 'rich', toolbar: true, width: 'full' })).toEqual({
      mode: 'rich',
      toolbar: true,
      width: 'full',
    });
  });

  it('falls back to the defaults on anything it does not recognise', () => {
    expect(parsePreferences({ mode: 'wysiwyg', toolbar: 'yes', width: 'narrow' })).toEqual(
      DEFAULT_DOC_PREFERENCES,
    );
    expect(parsePreferences(null)).toEqual(DEFAULT_DOC_PREFERENCES);
    expect(parsePreferences('nonsense')).toEqual(DEFAULT_DOC_PREFERENCES);
    expect(parsePreferences([])).toEqual(DEFAULT_DOC_PREFERENCES);
  });

  it('keeps the fields it understands when only one is corrupt', () => {
    expect(parsePreferences({ mode: 'rich', toolbar: true, width: 'nope' })).toEqual({
      mode: 'rich',
      toolbar: true,
      width: DEFAULT_DOC_PREFERENCES.width,
    });
  });
});

describe('the preference store', () => {
  beforeEach(() => {
    window.localStorage.removeItem(DOC_PREFERENCES_STORAGE_KEY);
    resetDocPreferences();
  });

  it('remembers a mode across a remount', () => {
    const first = renderHook(() => useDocPreferences());
    act(() => first.result.current.setMode('rich'));
    first.unmount();

    expect(renderHook(() => useDocPreferences()).result.current.mode).toBe('rich');
  });

  it('writes what it remembers to storage', () => {
    const { result } = renderHook(() => useDocPreferences());
    act(() => result.current.setWidth('full'));

    const stored = window.localStorage.getItem(DOC_PREFERENCES_STORAGE_KEY);
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ width: 'full' });
  });

  it('toggles the formatting bar without disturbing the rest', () => {
    const { result } = renderHook(() => useDocPreferences());
    act(() => result.current.setWidth('comfortable'));
    act(() => result.current.toggleToolbar());

    expect(result.current.toolbar).toBe(true);
    expect(result.current.width).toBe('comfortable');
  });

  it('re-reads what another tab wrote when storage announces a change', () => {
    const { result } = renderHook(() => useDocPreferences());
    expect(result.current.width).toBe('wide');

    act(() => {
      window.localStorage.setItem(
        DOC_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ mode: 'rich', toolbar: true, width: 'full' }),
      );
      window.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
    });

    expect(result.current.width).toBe('full');
    expect(result.current.mode).toBe('rich');
  });
});
