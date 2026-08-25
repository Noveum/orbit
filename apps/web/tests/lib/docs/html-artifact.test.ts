import { describe, expect, it } from 'bun:test';
import { htmlAttachmentHeaders } from '@/lib/docs/html-artifact.ts';

function contentTypeFor(value: string): string | null {
  return new Headers(htmlAttachmentHeaders(value)).get('content-type');
}

describe('html attachment headers', () => {
  it('preserves a safe declared charset on each accepted html type', () => {
    expect(contentTypeFor('text/html; charset=shift_jis')).toBe('text/html; charset=shift_jis');
    expect(contentTypeFor('application/xhtml+xml; CHARSET=ISO-8859-1')).toBe(
      'application/xhtml+xml; charset=ISO-8859-1',
    );
    expect(contentTypeFor('text/html; charset="utf-8"')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('text/html; title="x;y"; charset=shift_jis')).toBe(
      'text/html; charset=shift_jis',
    );
  });

  it('drops charset values that are not safe tokens', () => {
    for (const contentType of [
      'text/html; charset=utf-8 value',
      'text/html; charset="utf-8\\value"',
      'text/html; charset="utf-8',
      'text/html; charset=utf-8"',
      'text/html; charset=utf-8\r\nx-unsafe: value',
    ]) {
      expect(contentTypeFor(contentType)).toBe('text/html');
    }
  });

  it('drops ambiguous duplicate charset parameters', () => {
    expect(contentTypeFor('text/html; charset=utf-8; charset=shift_jis')).toBe('text/html');
  });

  it('does not parse charset text inside a quoted parameter', () => {
    expect(contentTypeFor('text/html; title="x; charset=shift_jis; y=z"')).toBe('text/html');
  });

  it('drops charsets when parameter quoting is malformed', () => {
    for (const contentType of [
      'text/html; title="x; charset=shift_jis',
      'text/html; charset="shift_jis',
      'text/html; title=x"; charset=shift_jis',
    ]) {
      expect(contentTypeFor(contentType)).toBe('text/html');
    }
  });
});
