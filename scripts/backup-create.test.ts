import { describe, expect, it } from 'bun:test';
import { parseArgs } from './backup/create.ts';

describe('backup create CLI args', () => {
  it('parses default arguments', () => {
    const args = parseArgs(['bun', 'scripts/backup/create.ts']);
    expect(typeof args.destination).toBe('string');
    expect(args.json).toBe(false);
  });

  it('parses explicit destination flag', () => {
    const args = parseArgs([
      'bun',
      'scripts/backup/create.ts',
      '--destination',
      '/var/backups/orbit',
    ]);
    expect(args.destination).toContain('orbit');
  });

  it('parses json flag and custom database url', () => {
    const args = parseArgs([
      'bun',
      'scripts/backup/create.ts',
      '--json',
      '--database-url',
      'postgres://user:pass@localhost:5432/testdb',
    ]);
    expect(args.json).toBe(true);
    expect(args.databaseUrl).toBe('postgres://user:pass@localhost:5432/testdb');
  });

  it('parses version and revision flags', () => {
    const args = parseArgs([
      'bun',
      'scripts/backup/create.ts',
      '--orbit-version',
      '1.2.3',
      '--source-revision',
      'git-sha-xyz',
    ]);
    expect(args.orbitVersion).toBe('1.2.3');
    expect(args.sourceRevision).toBe('git-sha-xyz');
  });
});
