import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_DOC_PREFERENCES,
  parsePreferences,
  READING_WIDTH_CLASS,
} from '@/features/docs/use-doc-preferences.ts';

describe('doc preferences', () => {
  it('opens a document in markdown with the formatting bar out of the way', () => {
    expect(DEFAULT_DOC_PREFERENCES.mode).toBe('markdown');
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
