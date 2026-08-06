import { describe, expect, it } from 'bun:test';
import {
  controlBytes,
  describe as describeByte,
  extensionOf,
  isTextSource,
} from '../../../scripts/check-source-bytes.ts';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const NUL = '\u0000';
const ESCAPE = '\u001b';
const VERTICAL_TAB = '\u000b';

describe('controlBytes', () => {
  it('passes ordinary source through', () => {
    expect(controlBytes(bytes('const key = `${a} ${b}`;\n\tindented\r\n'))).toEqual([]);
  });

  it('catches the NUL that a template literal will happily carry', () => {
    const found = controlBytes(bytes(`const key = \`\${teamId}${NUL}\${handles}\`;`));
    expect(found).toHaveLength(1);
    expect(found[0]?.byte).toBe(0);
  });

  it('reports the line the byte is on, not the offset alone', () => {
    const found = controlBytes(bytes(`one\ntwo\nthr${NUL}ee\n`));
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });

  it('catches other invisible control characters, not only NUL', () => {
    expect(controlBytes(bytes(`a${ESCAPE}b`))).toHaveLength(1);
    expect(controlBytes(bytes(`a${VERTICAL_TAB}b`))).toHaveLength(1);
  });

  it('leaves multibyte text alone', () => {
    expect(controlBytes(bytes('const name = "Ada Lovelace";'))).toEqual([]);
    expect(controlBytes(bytes('café 中文 \u{1f600}'))).toEqual([]);
  });
});

describe('isTextSource', () => {
  it('skips the binaries that legitimately contain control bytes', () => {
    expect(isTextSource('apps/web/public/logo.png')).toBe(false);
    expect(isTextSource('apps/web/src/app/favicon.ico')).toBe(false);
    expect(isTextSource('fonts/Inter.woff2')).toBe(false);
  });

  it('checks everything else', () => {
    expect(isTextSource('packages/core/src/work/issue-service.ts')).toBe(true);
    expect(isTextSource('README.md')).toBe(true);
    expect(isTextSource('Dockerfile')).toBe(true);
  });

  it('does not mistake a dot in a directory name for an extension', () => {
    expect(extensionOf('apps/web/src/app/.well-known/route.ts')).toBe('.ts');
    expect(extensionOf('.github/workflows/ci.yml')).toBe('.yml');
    expect(extensionOf('scripts/Makefile')).toBe('');
  });
});

describe('describe', () => {
  it('says where the byte is and what it is', () => {
    expect(describeByte('a/b.ts', { offset: 17858, line: 537, byte: 0 })).toBe(
      'a/b.ts:537: control byte 0x00 at offset 17858',
    );
  });
});
