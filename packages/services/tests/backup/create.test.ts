import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '@orbit/db/migration-release';
import { createBackup } from '../../src/backup/create.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

describe('createBackup', () => {
  it('throws when destination directory is empty', async () => {
    await expect(
      createBackup({
        destinationDir: '',
        databaseUrl: 'postgres://orbit:orbit@localhost:5434/orbit',
      }),
    ).rejects.toThrow();
  });

  it('throws when database url is missing', async () => {
    await expect(
      createBackup({
        destinationDir: '/tmp/orbit-test',
        databaseUrl: '',
      }),
    ).rejects.toThrow();
  });

  it('marks incomplete backup atomically when pg_dump fails or is missing', async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) return;

    await releaseDatabase(databaseUrl, MIGRATIONS);

    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-create-test-'));
    try {
      let thrownError: Error | undefined;
      try {
        await createBackup({
          destinationDir: tempDir,
          databaseUrl,
          pgDumpPath: 'non_existent_pg_dump_binary_xyz',
        });
      } catch (err) {
        thrownError = err as Error;
      }

      expect(thrownError).toBeDefined();

      const files = await readdir(tempDir);
      const incomplete = files.filter((f) => f.endsWith('.incomplete'));
      const successful = files.filter((f) => !(f.endsWith('.incomplete') || f.endsWith('.tmp')));

      expect(incomplete.length).toBe(1);
      expect(successful.length).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
