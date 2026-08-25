import { describe, expect, it } from 'bun:test';
import { storageKeyFrom } from '@/lib/api/attachment-access.ts';

describe('storageKeyFrom', () => {
  it('joins the segments a route handed it', () => {
    expect(storageKeyFrom(['org-1', 'doc-1', 'page.html'])).toBe('org-1/doc-1/page.html');
  });

  it('keeps a dot inside a segment, which is just a file extension', () => {
    expect(storageKeyFrom(['org-1', 'report.v2.html'])).toBe('org-1/report.v2.html');
  });

  it('refuses a segment that walks up the path', () => {
    expect(() => storageKeyFrom(['org-1', '..', 'secret.html'])).toThrow();
  });

  it('refuses a segment that is the current directory', () => {
    expect(() => storageKeyFrom(['org-1', '.', 'page.html'])).toThrow();
  });

  it('refuses a segment carrying a separator or an escape', () => {
    expect(() => storageKeyFrom(['org-1', 'a/b'])).toThrow();
    expect(() => storageKeyFrom(['org-1', '%2e%2e'])).toThrow();
  });

  it('refuses an empty key', () => {
    expect(() => storageKeyFrom([])).toThrow();
  });
});
