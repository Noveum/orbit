import { describe, expect, test } from 'bun:test';
import { contentWidthClassName } from './top-bar.tsx';

describe('contentWidthClassName', () => {
  test('spans the full available width', () => {
    expect(contentWidthClassName).toContain('w-full');
  });

  test('applies no hard column cap that leaves dead space on wide screens', () => {
    expect(contentWidthClassName).not.toContain('max-w-page');
    expect(contentWidthClassName).not.toMatch(/max-w-\[/);
    expect(contentWidthClassName).not.toMatch(/\dxl:max-w/);
  });
});
