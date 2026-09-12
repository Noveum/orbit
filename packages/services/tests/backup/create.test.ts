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
import type { StorageDriver, StoredObject, UploadTarget } from '../../src/storage/types.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

let resolvedPgDump: string | undefined;
let discoveredContainerId: string | undefined;
let temporaryShimDir: string | undefined;

async function getServerMajorVersion(databaseUrl: string): Promise<number | undefined> {
  try {
    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      const [row] = await sql<{ major: number }[]>`
        select current_setting('server_version_num')::int / 10000 as major
      `;
      return row?.major;
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch {
    return undefined;
  }
}

function getHostPgDumpMajor(): number | undefined {
  try {
    const probe = Bun.spawnSync(['pg_dump', '--version']);
    if (probe.exitCode !== 0) return undefined;
    const match = probe.stdout.toString().match(/\b(\d+)\./);
    return match ? Number.parseInt(match[1] ?? '0', 10) : undefined;
  } catch {
    return undefined;
  }
}

function findPostgresContainer(): string | undefined {
  try {
    const res = Bun.spawnSync(['docker', 'ps', '--format', '{{.ID}} {{.Image}} {{.Names}}']);
    if (res.exitCode !== 0) return undefined;
    for (const line of res.stdout.toString().split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split(/\s+/);
      const id = parts[0];
      const image = parts[1] ?? '';
      const name = parts[2] ?? '';
      if (id !== undefined && (image.includes('postgres') || name.includes('postgres'))) {
        const probe = Bun.spawnSync(['docker', 'exec', id, 'pg_dump', '--version']);
        if (probe.exitCode === 0) {
          return id;
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function setupPgDump(databaseUrl: string): Promise<string | undefined> {
  const serverMajor = await getServerMajorVersion(databaseUrl);
  const hostMajor = getHostPgDumpMajor();
  if (hostMajor !== undefined && (serverMajor === undefined || hostMajor >= serverMajor)) {
    return undefined;
  }

  const containerId = findPostgresContainer();
  if (containerId !== undefined) {
    discoveredContainerId = containerId;
    const shimDir = await mkdtemp(join(tmpdir(), 'orbit-pg-dump-shim-'));
    temporaryShimDir = shimDir;
    const isWindows = process.platform === 'win32';
    const shimExe = join(shimDir, isWindows ? 'pg_dump.exe' : 'pg_dump');
    const shimSource = join(shimDir, 'shim.ts');
    await writeFile(
      shimSource,
      `import { spawn } from 'node:child_process';
const args = process.argv.slice(2).map((a) => a.replace(/:543[34]\\b/g, ':5432'));
const child = spawn('docker', ['exec', '-i', '-e', \`PGPASSWORD=\${process.env['PGPASSWORD'] ?? ''}\`, '${containerId}', 'pg_dump', ...args], {
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

  const containerTarget = discoveredContainerId ?? 'orbit-postgres';
  let dockerRestoreSuccess = false;
  let dockerOutput = '';
  try {
    const dockerRestore = Bun.spawnSync(
      ['docker', 'exec', '-i', containerTarget, 'pg_restore', '-l'],
      { stdin: fileBytes },
    );
    if (dockerRestore.exitCode === 0) {
      dockerRestoreSuccess = true;
      dockerOutput = dockerRestore.stdout.toString();
    }
  } catch {
    dockerRestoreSuccess = false;
  }
  if (dockerRestoreSuccess) {
    return dockerOutput;
  }

  return fileBytes.toString('utf8');
}

function createMockDriver(store: Map<string, Uint8Array>): StorageDriver {
  return {
    name: 's3',
    get(key: string): Promise<Uint8Array | null> {
      return Promise.resolve(store.get(key) ?? null);
    },
    put(key: string, body: Uint8Array): Promise<void> {
      store.set(key, body);
      return Promise.resolve();
    },
    stat(key: string): Promise<StoredObject | null> {
      const data = store.get(key);
      if (data === undefined) return Promise.resolve(null);
      return Promise.resolve({
        key,
        size: data.byteLength,
        contentType: 'application/octet-stream',
        updatedAt: new Date(),
      });
    },
    delete(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    summarizePrefix(): Promise<{
      objects: number;
      bytes: number;
      versions: number;
      versionBytes: number;
    }> {
      return Promise.resolve({ objects: 0, bytes: 0, versions: 0, versionBytes: 0 });
    },
    deletePrefix(): Promise<void> {
      return Promise.resolve();
    },
    getUrl(): Promise<string> {
      return Promise.resolve('');
    },
    createUploadTarget(key: string, _contentType: string, maxBytes: number): Promise<UploadTarget> {
      return Promise.resolve({
        key,
        url: 'http://localhost/upload',
        method: 'PUT',
        headers: {},
        maxBytes,
        expiresAt: new Date().toISOString(),
      });
    },
  };
}

describe('createBackup', () => {
  beforeAll(async () => {
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_svc');
    resolvedPgDump = await setupPgDump(databaseUrl);
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
          storageDriver: createMockDriver(new Map()),
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

    const store = new Map<string, Uint8Array>();
    const driver = createMockDriver(store);
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
        customMetadata: {
          generator: 'custom-generator-attempt',
          boundedConsistencyModel: 'custom-model-attempt',
          extraLabel: 'production-daily',
        },
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
      expect(manifest.metadata['generator']).toBe('orbit-backup-create');
      expect(manifest.metadata['boundedConsistencyModel']).toBe(
        'postgres-snapshot-coordinated-object-capture',
      );
      expect(manifest.metadata['extraLabel']).toBe('production-daily');

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
