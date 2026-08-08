import { describe, expect, it } from 'bun:test';
import {
  bunImports,
  describe as describeImport,
  isShippedSource,
} from '../../../scripts/check-bun-imports.ts';

function specifiers(text: string): string[] {
  return bunImports('packages/realtime-server/src/socket.ts', text).map((entry) => entry.specifier);
}

describe('deciding which files ship to the node runtime', () => {
  it('covers the packages the web app pulls in', () => {
    expect(isShippedSource('packages/realtime-server/src/socket.ts')).toBe(true);
    expect(isShippedSource('packages/core/src/work/issue-service.ts')).toBe(true);
    expect(isShippedSource('apps/web/src/lib/api/handler.ts')).toBe(true);
  });

  it('leaves the places CLAUDE.md allows Bun built-ins alone', () => {
    expect(isShippedSource('apps/realtime/src/server.ts')).toBe(false);
    expect(isShippedSource('scripts/check-source-bytes.ts')).toBe(false);
  });

  it('covers the database seed, which is under packages and exempted nowhere', () => {
    expect(isShippedSource('packages/db/src/seed/index.ts')).toBe(true);
  });

  it('leaves test trees alone, since they only ever run under Bun', () => {
    expect(isShippedSource('packages/core/tests/work/issue-service.test.ts')).toBe(false);
    expect(isShippedSource('apps/web/tests-support.ts')).toBe(false);
    expect(isShippedSource('packages/core/tests-preload.ts')).toBe(false);
  });

  it('ignores files that are not typescript source', () => {
    expect(isShippedSource('packages/core/src/schema.sql')).toBe(false);
    expect(isShippedSource('packages/db/catchup/view-filter-repair.sql')).toBe(false);
  });
});

describe('finding a Bun built-in that would reach the node runtime', () => {
  it('allows a type-only import, because it is erased before it ships', () => {
    expect(specifiers("import type { ServerWebSocket } from 'bun';\n")).toEqual([]);
  });

  it('catches a value import', () => {
    expect(specifiers("import { serve } from 'bun';\n")).toEqual(['bun']);
  });

  it('catches a default import', () => {
    expect(specifiers("import Bun from 'bun';\n")).toEqual(['bun']);
  });

  it('catches a namespaced built-in like bun:sqlite', () => {
    expect(specifiers("import { Database } from 'bun:sqlite';\n")).toEqual(['bun:sqlite']);
  });

  it('catches a side effect import', () => {
    expect(specifiers("import 'bun';\n")).toEqual(['bun']);
  });

  it('catches require and dynamic import, which no compiler erases', () => {
    expect(specifiers("const bun = require('bun');\n")).toEqual(['bun']);
    expect(specifiers("const bun = await import('bun');\n")).toEqual(['bun']);
  });

  it('does not mistake a package whose name merely starts with bun', () => {
    expect(specifiers("import { thing } from 'bundler-utils';\n")).toEqual([]);
    expect(specifiers("import { thing } from '@orbit/bunny';\n")).toEqual([]);
  });

  it('reports where the import was, so the failure names the offender', () => {
    const found = bunImports('packages/core/src/a.ts', "const a = 1;\nimport { x } from 'bun';\n");

    expect(found).toHaveLength(1);
    expect(describeImport(found[0] ?? { file: '', specifier: '', line: 0 })).toBe(
      'packages/core/src/a.ts:2 imports "bun" at runtime.',
    );
  });
});

describe('a type binding that the compiler erases', () => {
  it('allows a type marked on each binding rather than on the declaration', () => {
    expect(specifiers("import { type ServerWebSocket } from 'bun';\n")).toEqual([]);
    expect(specifiers("import { type A, type B } from 'bun';\n")).toEqual([]);
  });

  it('still catches a value smuggled in beside a type binding', () => {
    expect(specifiers("import { type A, serve } from 'bun';\n")).toEqual(['bun']);
  });

  it('allows an erased re-export', () => {
    expect(specifiers("export type { ServerWebSocket } from 'bun';\n")).toEqual([]);
    expect(specifiers("export { type ServerWebSocket } from 'bun';\n")).toEqual([]);
  });
});

describe('a re-export that keeps the dependency at runtime', () => {
  it('catches a named re-export', () => {
    expect(specifiers("export { serve } from 'bun';\n")).toEqual(['bun']);
  });

  it('catches a star re-export', () => {
    expect(specifiers("export * from 'bun:sqlite';\n")).toEqual(['bun:sqlite']);
  });

  it('catches a namespaced star re-export', () => {
    expect(specifiers("export * as bun from 'bun';\n")).toEqual(['bun']);
  });

  it('reports one entry per offending line, not one per pattern that matched', () => {
    expect(specifiers("import { serve } from 'bun';\n")).toHaveLength(1);
  });
});
