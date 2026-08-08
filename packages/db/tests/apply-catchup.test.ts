import { describe, expect, it } from 'bun:test';
import { catchupPath, targetName } from '../src/apply-catchup.ts';

describe('catchupPath', () => {
  it('resolves a script by name inside the catchup directory', () => {
    expect(catchupPath('doc-tree-schema-catchup.sql')).toEndWith(
      '/catchup/doc-tree-schema-catchup.sql',
    );
  });

  it('accepts the repository relative path the runbook prints', () => {
    expect(catchupPath('packages/db/catchup/doc-tree-order-catchup.sql')).toEndWith(
      '/catchup/doc-tree-order-catchup.sql',
    );
  });

  it('refuses a file outside the catchup directory', () => {
    expect(() => catchupPath('../../../etc/passwd.sql')).toThrow();
    expect(() => catchupPath('/tmp/anything.sql')).toThrow();
  });

  it('refuses a file that is not sql', () => {
    expect(() => catchupPath('notes.md')).toThrow();
  });
});

describe('targetName', () => {
  it('names a database without carrying its credentials', () => {
    const named = targetName('postgres://someone:hunter2@db.example.com:5432/orbit');
    expect(named).toBe('db.example.com/orbit');
    expect(named).not.toContain('hunter2');
  });

  it('says something sensible for a url it cannot parse', () => {
    expect(targetName('not a url')).toBe('the configured database');
  });
});
