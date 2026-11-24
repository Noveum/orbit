import { describe, expect, test } from 'bun:test';
import { tsComments } from './strip-comments.ts';

function flagged(file: string, source: string): string[] {
  return tsComments(file, source).remove.map((range) => source.slice(range.pos, range.end));
}

describe('tsComments', () => {
  test('flags a plain line comment and a plain block comment', () => {
    expect(flagged('a.ts', 'const a = 1; // note\n/* block */ const b = 2;\n')).toEqual([
      '// note',
      '/* block */',
    ]);
  });

  test('keeps license blocks and functional directives', () => {
    const source = [
      '/*! license */',
      '// @ts-expect-error reason',
      '// biome-ignore lint/style/noNonNullAssertion: reason',
      '/// <reference types="bun" />',
      'const a: number = "x";',
    ].join('\n');
    expect(tsComments('a.ts', source)).toEqual({ remove: [], kept: 4 });
  });

  test('flags a bang line comment, since only block license comments are kept', () => {
    expect(flagged('a.ts', '//! not a license\nconst a = 1;\n')).toEqual(['//! not a license']);
  });

  test('ignores comment syntax inside strings, templates and JSX text', () => {
    const source = [
      'const url = "https://example.com/* not */";',
      'const path = `a // b`;',
      'export const View = () => <p>// not a comment /* either */</p>;',
    ].join('\n');
    expect(flagged('a.tsx', source)).toEqual([]);
  });

  test('flags a comment inside a JSX expression', () => {
    expect(flagged('a.tsx', 'export const View = () => <p>{/* hidden */}</p>;\n')).toEqual([
      '/* hidden */',
    ]);
  });

  test('refuses a file it cannot parse instead of reporting no comments', () => {
    expect(() => tsComments('broken.ts', 'const = ; // hidden\n')).toThrow(
      'Could not parse broken.ts',
    );
  });
});
