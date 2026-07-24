import { describe, expect, it } from 'bun:test';
import { safeNextPath } from './next-path.ts';

describe('safeNextPath', () => {
  it('keeps a plain internal path', () => {
    expect(safeNextPath('/projects')).toBe('/projects');
    expect(safeNextPath('/team/nov/board?tab=active')).toBe('/team/nov/board?tab=active');
    expect(safeNextPath('/my-issues')).toBe('/my-issues');
  });

  it('rejects absolute and protocol-relative urls', () => {
    expect(safeNextPath('https://evil.example.com')).toBeNull();
    expect(safeNextPath('//evil.example.com')).toBeNull();
    expect(safeNextPath('http://localhost/next')).toBeNull();
    expect(safeNextPath('/\\evil.example.com')).toBeNull();
  });

  it('rejects non-strings, relative paths, and control characters', () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(['/a', '/b'])).toBeNull();
    expect(safeNextPath('projects')).toBeNull();
    expect(safeNextPath('/pro\njects')).toBeNull();
  });
});
