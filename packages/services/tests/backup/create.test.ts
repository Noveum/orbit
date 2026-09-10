import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '@orbit/db/migration-release';
import { backupManifestSchema } from '@orbit/shared';
import postgres from 'postgres';
import { resolveTestDatabaseUrl } from '../../../../scripts/test-env.ts';
import { createBackup } from '../../src/backup/create.ts';
import { storageDriver } from '../../src/storage/index.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

let resolvedPgDump: string | undefined;
let temporaryShimDir: string | undefined;

async function setupPgDump(): Promise<string | undefined> {
  let hasHostPgDump = false;
  try {
    const probe = Bun.spawnSync(['pg_dump', '--version']);
    hasHostPgDump = probe.exitCode === 0;
  } catch {
    hasHostPgDump = false;
  }
  if (hasHostPgDump) return undefined;

  let hasDockerPgDump = false;
  try {
    const dockerProbe = Bun.spawnSync(['docker', 'exec', 'orbit-postgres', 'pg_dump', '--version']);
    hasDockerPgDump = dockerProbe.exitCode === 0;
  } catch {
    hasDockerPgDump = false;
  }

  if (hasDockerPgDump) {
    const shimDir = await mkdtemp(join(tmpdir(), 'orbit-pg-dump-shim-'));
    temporaryShimDir = shimDir;
    const shimSource = join(shimDir, 'shim.ts');
    const shimExe = join(shimDir, 'pg_dump.exe');
    await writeFile(
      shimSource,
      `import { spawn } from 'node:child_process';
const args = process.argv.slice(2).map((a) => a.replace(':5434', ':5432'));
const child = spawn('docker', ['exec', '-i', '-e', \`PGPASSWORD=\${process.env['PGPASSWORD'] ?? ''}\`, 'orbit-postgres', 'pg_dump', ...args], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
child.stdout.pipe(process.stdout);
child.on('close', (code) => process.exit(code ?? 0));
`,
    );
    Bun.spawnSync(['bun', 'build', '--compile', shimSource, '--outfile', shimExe]);
    await rm(shimSource, { force: true }).catch(() => undefined);
    return shimExe;
  }

  return undefined;
}

async function inspectArchive(dumpPath: string): Promise<string> {
  const fileBytes = await readFile(dumpPath);
  let hostRestoreSuccess = false;
  let hostOutput = '';
  try {
    const probe = Bun.spawnSync(['pg_restore', '--version']);
    if (probe.exitCode === 0) {
      const restore = Bun.spawnSync(['pg_restore', '-l', dumpPath]);
      if (restore.exitCode === 0) {
        hostRestoreSuccess = true;
        hostOutput = restore.stdout.toString();
      }
    }
  } catch {
    hostRestoreSuccess = false;
  }
  if (hostRestoreSuccess) {
    return hostOutput;
  }

  const dockerRestore = Bun.spawnSync(
    ['docker', 'exec', '-i', 'orbit-postgres', 'pg_restore', '-l'],
    { stdin: fileBytes },
  );
  if (dockerRestore.exitCode !== 0) {
    throw new Error(
      `docker pg_restore failed with exit code ${dockerRestore.exitCode}: ${dockerRestore.stderr.toString()}`,
    );
  }
  return dockerRestore.stdout.toString();
}

describe('createBackup', () => {
  beforeAll(async () => {
    resolvedPgDump = await setupPgDump();
  });

  afterAll(async () => {
    if (temporaryShimDir !== undefined) {
      await rm(temporaryShimDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

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
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_svc');

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

  it('marks incomplete backup atomically when object capture fails', async () => {
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_svc');
    await releaseDatabase(databaseUrl, MIGRATIONS);

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orgId = `org_fail_${stamp}`;
    const userId = `usr_fail_${stamp}`;
    const attId = `att_fail_${stamp}`;
    const missingKey = `test_missing_${stamp}/file.txt`;

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await sql`insert into organization (id, name, slug) values (${orgId}, 'Fail Test Org', ${orgId})`;
      await sql`insert into "user" (id, name, email, handle) values (${userId}, 'Fail User', ${`${userId}@orbit.test`}, ${userId})`;
      await sql`
        insert into attachment (id, organization_id, parent_type, parent_id, file_name, content_type, size, storage_key, status, uploaded_by_id)
        values (${attId}, ${orgId}, 'issue', 'dummy-issue', 'file.txt', 'text/plain', 100, ${missingKey}, 'ready', ${userId})
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-create-fail-test-'));
    try {
      let thrownError: Error | undefined;
      try {
        await createBackup({
          destinationDir: tempDir,
          databaseUrl,
          ...(resolvedPgDump === undefined ? {} : { pgDumpPath: resolvedPgDump }),
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
      const cleanupSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await cleanupSql`delete from attachment where id = ${attId}`;
        await cleanupSql`delete from "user" where id = ${userId}`;
        await cleanupSql`delete from organization where id = ${orgId}`;
      } finally {
        await cleanupSql.end({ timeout: 5 });
      }
    }
  });

  it('exercises a complete successful backup with database dump and storage capture', async () => {
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_svc');
    await releaseDatabase(databaseUrl, MIGRATIONS);

    const testBytes = new TextEncoder().encode('successful backup integration test payload');
    const expectedSha256 = createHash('sha256').update(testBytes).digest('hex');

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orgId = `org_succ_${stamp}`;
    const userId = `usr_succ_${stamp}`;
    const attId = `att_succ_${stamp}`;
    const storageKey = `test_success_${stamp}/payload.txt`;

    const driver = storageDriver();
    await driver.put(storageKey, testBytes, 'text/plain');

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await sql`insert into organization (id, name, slug) values (${orgId}, 'Success Test Org', ${orgId})`;
      await sql`insert into "user" (id, name, email, handle) values (${userId}, 'Success User', ${`${userId}@orbit.test`}, ${userId})`;
      await sql`
        insert into attachment (id, organization_id, parent_type, parent_id, file_name, content_type, size, storage_key, status, uploaded_by_id)
        values (${attId}, ${orgId}, 'issue', 'dummy-issue', 'payload.txt', 'text/plain', ${testBytes.byteLength}, ${storageKey}, 'ready', ${userId})
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-create-succ-test-'));
    try {
      const result = await createBackup({
        destinationDir: tempDir,
        databaseUrl,
        storageDriver: driver,
        ...(resolvedPgDump === undefined ? {} : { pgDumpPath: resolvedPgDump }),
      });

      expect(result.backupId).toBeDefined();
      expect(result.backupDir).toBeDefined();

      const files = await readdir(tempDir);
      const incomplete = files.filter((f) => f.endsWith('.incomplete'));
      const tmp = files.filter((f) => f.endsWith('.tmp'));
      const successful = files.filter((f) => !(f.endsWith('.incomplete') || f.endsWith('.tmp')));

      expect(incomplete.length).toBe(0);
      expect(tmp.length).toBe(0);
      expect(successful.length).toBe(1);
      expect(successful[0]).toBe(result.backupId);

      const manifestPath = join(result.backupDir, 'manifest.json');
      const manifestRaw = await readFile(manifestPath, 'utf8');
      const manifest = backupManifestSchema.parse(JSON.parse(manifestRaw));

      expect(manifest.formatVersion).toBe('1.0.0');
      expect(manifest.counts.workspaces).toBeGreaterThanOrEqual(1);
      expect(manifest.counts.users).toBeGreaterThanOrEqual(1);
      expect(manifest.counts.attachments).toBeGreaterThanOrEqual(1);

      const dumpPath = join(result.backupDir, manifest.checksums.databaseDump.file);
      const dumpBytes = await readFile(dumpPath);
      const dumpSha = createHash('sha256').update(dumpBytes).digest('hex');
      expect(dumpBytes.byteLength).toBe(manifest.checksums.databaseDump.bytes);
      expect(dumpSha).toBe(manifest.checksums.databaseDump.sha256);

      const objectEntry = manifest.checksums.objects.find((obj) => obj.key === storageKey);
      expect(objectEntry).toBeDefined();
      expect(objectEntry?.bytes).toBe(testBytes.byteLength);
      expect(objectEntry?.sha256).toBe(expectedSha256);
      expect(objectEntry?.contentType).toBe('text/plain');

      const capturedObjectPath = join(result.backupDir, 'objects', storageKey);
      const capturedBytes = await readFile(capturedObjectPath);
      expect(new Uint8Array(capturedBytes)).toEqual(testBytes);

      const toc = await inspectArchive(dumpPath);
      expect(toc).toContain('TABLE DATA public organization');
      expect(toc).toContain('TABLE DATA public attachment');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await driver.delete(storageKey).catch(() => undefined);
      const cleanupSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await cleanupSql`delete from attachment where id = ${attId}`;
        await cleanupSql`delete from "user" where id = ${userId}`;
        await cleanupSql`delete from organization where id = ${orgId}`;
      } finally {
        await cleanupSql.end({ timeout: 5 });
      }
    }
  });
});
