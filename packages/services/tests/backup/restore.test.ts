import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '@orbit/db/migration-release';
import { computeRestoreTargetIdentity } from '@orbit/shared';
import postgres from 'postgres';
import { resolveTestDatabaseUrl } from '../../../../scripts/test-env.ts';
import { createBackup } from '../../src/backup/create.ts';
import {
  acquireRestoreLock,
  getRecoveryState,
  setRecoveryState,
} from '../../src/backup/readiness.ts';
import { restoreBackup } from '../../src/backup/restore.ts';
import type { StorageDriver, StoredObject, UploadTarget } from '../../src/storage/types.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

let temporaryShimDir: string | undefined;
let resolvedPgDump: string | undefined;
let resolvedPgRestore: string | undefined;

function getHostPgToolMajor(tool: 'pg_dump' | 'pg_restore'): number | undefined {
  try {
    const probe = Bun.spawnSync([tool, '--version']);
    if (probe.exitCode !== 0) return undefined;
    const match = probe.stdout.toString().match(/\b(\d+)\./);
    return match ? Number.parseInt(match[1] ?? '0', 10) : undefined;
  } catch {
    return undefined;
  }
}

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

async function setupPostgresTools(databaseUrl: string): Promise<{
  pgDumpPath?: string | undefined;
  pgRestorePath?: string | undefined;
}> {
  const serverMajor = await getServerMajorVersion(databaseUrl);
  const hostDumpMajor = getHostPgToolMajor('pg_dump');
  const hostRestoreMajor = getHostPgToolMajor('pg_restore');

  const dumpNeedsShim =
    hostDumpMajor === undefined || (serverMajor !== undefined && hostDumpMajor < serverMajor);
  const restoreNeedsShim =
    hostRestoreMajor === undefined || (serverMajor !== undefined && hostRestoreMajor < serverMajor);

  if (!(dumpNeedsShim || restoreNeedsShim)) {
    return {};
  }

  const containerId = findPostgresContainer();
  if (containerId === undefined) {
    return {};
  }

  const shimDir = await mkdtemp(join(tmpdir(), 'orbit-pg-shims-'));
  temporaryShimDir = shimDir;
  const isWindows = process.platform === 'win32';

  let pgDumpPath: string | undefined;
  if (dumpNeedsShim) {
    const dumpLauncher = join(shimDir, isWindows ? 'pg_dump.exe' : 'pg_dump');
    const dumpSource = join(shimDir, 'dump_shim.ts');
    await writeFile(
      dumpSource,
      `import { spawn } from 'node:child_process';
const args = process.argv.slice(2).map((a) => a.replace(/:543[34]\\b/g, ':5432'));
const child = spawn('docker', ['exec', '-i', '-e', \`PGPASSWORD=\${process.env['PGPASSWORD'] ?? ''}\`, '${containerId}', 'pg_dump', ...args], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
child.stdout.pipe(process.stdout);
child.on('close', (code) => process.exit(code ?? 0));
`,
    );
    if (isWindows) {
      Bun.spawnSync(['bun', 'build', '--compile', dumpSource, '--outfile', dumpLauncher]);
    } else {
      await writeFile(dumpLauncher, `#!/bin/sh\nexec bun run "${dumpSource}" "$@"\n`, {
        mode: 0o755,
      });
    }
    pgDumpPath = dumpLauncher;
  }

  let pgRestorePath: string | undefined;
  if (restoreNeedsShim) {
    const restoreLauncher = join(shimDir, isWindows ? 'pg_restore.exe' : 'pg_restore');
    const restoreSource = join(shimDir, 'restore_shim.ts');
    await writeFile(
      restoreSource,
      `import { spawn, spawnSync } from 'node:child_process';
const rawArgs = process.argv.slice(2);
const lastArg = rawArgs[rawArgs.length - 1];
let dumpContainerPath = '';
if (lastArg && !lastArg.startsWith('-')) {
  const containerDump = \`/tmp/restore_\${Date.now()}_\${Math.random().toString(36).slice(2, 6)}.dump\`;
  spawnSync('docker', ['cp', lastArg, \`${containerId}:\${containerDump}\`]);
  dumpContainerPath = containerDump;
}
const args = rawArgs.slice(0, dumpContainerPath ? -1 : undefined).map((a) => a.replace(/:543[34]\\b/g, ':5432'));
if (dumpContainerPath) {
  args.push(dumpContainerPath);
}
const child = spawn('docker', ['exec', '-i', '-e', \`PGPASSWORD=\${process.env['PGPASSWORD'] ?? ''}\`, '${containerId}', 'pg_restore', ...args], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('close', (code) => {
  if (dumpContainerPath) {
    spawnSync('docker', ['exec', '${containerId}', 'rm', '-f', dumpContainerPath]);
  }
  process.exit(code ?? 0);
});
`,
    );
    if (isWindows) {
      Bun.spawnSync(['bun', 'build', '--compile', restoreSource, '--outfile', restoreLauncher]);
    } else {
      await writeFile(restoreLauncher, `#!/bin/sh\nexec bun run "${restoreSource}" "$@"\n`, {
        mode: 0o755,
      });
    }
    pgRestorePath = restoreLauncher;
  }

  return { pgDumpPath, pgRestorePath };
}

async function isDatabaseReachable(url: string): Promise<boolean> {
  const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 2, prepare: false });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 });
  }
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

describe('restoreBackup integration and readiness lifecycle', () => {
  const databaseUrl = resolveTestDatabaseUrl('orbit_test_svc');
  let reachable = false;

  beforeAll(async () => {
    reachable = await isDatabaseReachable(databaseUrl);
    expect(reachable).toBe(true);
    const tools = await setupPostgresTools(databaseUrl);
    resolvedPgDump = tools.pgDumpPath;
    resolvedPgRestore = tools.pgRestorePath;
    await releaseDatabase(databaseUrl, MIGRATIONS);
  });

  afterAll(async () => {
    if (temporaryShimDir !== undefined) {
      await rm(temporaryShimDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('rejects concurrent restore attempt when another restore holds the lock', async () => {
    expect(reachable).toBe(true);

    const tempBackupDir = await mkdtemp(join(tmpdir(), 'orbit-lock-test-'));
    const driverStore = new Map<string, Uint8Array>();
    const driver = createMockDriver(driverStore);
    try {
      const backupResult = await createBackup({
        destinationDir: tempBackupDir,
        databaseUrl,
        storageDriver: driver,
        pgDumpPath: resolvedPgDump,
      });

      const lock = await acquireRestoreLock(databaseUrl);
      try {
        await expect(
          restoreBackup({
            backupPath: backupResult.backupDir,
            databaseUrl,
            confirmDestructiveRestoreTarget: computeRestoreTargetIdentity(
              databaseUrl,
              process.env['S3_BUCKET'],
            ).identity,
            storageDriver: driver,
            skipRedisCheck: true,
            pgRestorePath: resolvedPgRestore,
          }),
        ).rejects.toThrow(/Another restore operation is currently in progress/);

        await expect(acquireRestoreLock(databaseUrl)).rejects.toThrow(
          /Another restore operation is currently in progress/,
        );
      } finally {
        await lock.release();
      }

      await setRecoveryState(databaseUrl, 'restoring', 'interrupted');
      const retryLock = await acquireRestoreLock(databaseUrl);
      await retryLock.release();
    } finally {
      await rm(tempBackupDir, { recursive: true, force: true }).catch(() => undefined);
      await setRecoveryState(databaseUrl, 'ready');
    }
  });

  it('preserves readiness progression throughout recovery and succeeds', async () => {
    expect(reachable).toBe(true);

    await releaseDatabase(databaseUrl, MIGRATIONS);

    const initSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await initSql`delete from attachment`;
      await initSql`delete from comment`;
      await initSql`delete from issue`;
      await initSql`delete from doc`;
      await initSql`delete from project`;
      await initSql`delete from team_member`;
      await initSql`delete from team`;
      await initSql`delete from member`;
      await initSql`delete from account`;
      await initSql`delete from "user"`;
      await initSql`delete from organization`;
    } finally {
      await initSql.end({ timeout: 5 });
    }

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orgId = `org_rst_${stamp}`;
    const userId = `usr_rst_${stamp}`;
    const memberId = `mbr_rst_${stamp}`;

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await sql`insert into organization (id, name, slug) values (${orgId}, 'Rst Org', ${orgId})`;
      await sql`insert into "user" (id, name, email, handle) values (${userId}, 'Rst User', ${`${userId}@orbit.test`}, ${userId})`;
      await sql`insert into member (id, organization_id, user_id, role) values (${memberId}, ${orgId}, ${userId}, 'owner')`;
    } finally {
      await sql.end({ timeout: 5 });
    }

    await setRecoveryState(databaseUrl, 'ready');

    const tempBackupDir = await mkdtemp(join(tmpdir(), 'orbit-rst-test-'));
    const driverStore = new Map<string, Uint8Array>();
    const driver = createMockDriver(driverStore);

    try {
      const backupResult = await createBackup({
        destinationDir: tempBackupDir,
        databaseUrl,
        storageDriver: driver,
        pgDumpPath: resolvedPgDump,
      });

      expect(backupResult.manifest.checksums.databaseDump.bytes).toBeGreaterThan(0);

      const mutateSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await mutateSql`update organization set name = 'Mutated Org' where id = ${orgId}`;
      } finally {
        await mutateSql.end({ timeout: 5 });
      }

      const targetIdentity = computeRestoreTargetIdentity(
        databaseUrl,
        process.env['S3_BUCKET'],
      ).identity;

      const restoreResult = await restoreBackup({
        backupPath: backupResult.backupDir,
        databaseUrl,
        confirmDestructiveRestoreTarget: targetIdentity,
        storageDriver: driver,
        pgRestorePath: resolvedPgRestore,
        skipRedisCheck: true,
      });

      expect(restoreResult.databaseRestored).toBe(true);
      expect(restoreResult.validation.valid).toBe(true);

      const postState = await getRecoveryState(databaseUrl);
      expect(postState?.status).toBe('ready');

      const verifySql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        const [orgRow] = await verifySql<{ id: string; name: string }[]>`
          select id, name from organization where id = ${orgId}
        `;
        expect(orgRow?.id).toBe(orgId);
        expect(orgRow?.name).toBe('Rst Org');
      } finally {
        await verifySql.end({ timeout: 5 });
      }
    } finally {
      await rm(tempBackupDir, { recursive: true, force: true }).catch(() => undefined);
      const cleanupSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await cleanupSql`delete from member where id = ${memberId}`;
        await cleanupSql`delete from "user" where id = ${userId}`;
        await cleanupSql`delete from organization where id = ${orgId}`;
      } finally {
        await cleanupSql.end({ timeout: 5 });
      }
    }
  }, 30_000);

  it('marks recovery state as validation_failed when validation fails after restore', async () => {
    expect(reachable).toBe(true);

    await releaseDatabase(databaseUrl, MIGRATIONS);

    const initSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await initSql`delete from attachment`;
      await initSql`delete from comment`;
      await initSql`delete from issue`;
      await initSql`delete from doc`;
      await initSql`delete from project`;
      await initSql`delete from team_member`;
      await initSql`delete from team`;
      await initSql`delete from member`;
      await initSql`delete from account`;
      await initSql`delete from "user"`;
      await initSql`delete from organization`;
    } finally {
      await initSql.end({ timeout: 5 });
    }

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orgId = `org_fail_${stamp}`;
    const userId = `usr_fail_${stamp}`;
    const memberId = `mbr_fail_${stamp}`;

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await sql`insert into organization (id, name, slug) values (${orgId}, 'Fail Org', ${orgId})`;
      await sql`insert into "user" (id, name, email, handle) values (${userId}, 'Fail User', ${`${userId}@orbit.test`}, ${userId})`;
      await sql`insert into member (id, organization_id, user_id, role) values (${memberId}, ${orgId}, ${userId}, 'owner')`;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const tempBackupDir = await mkdtemp(join(tmpdir(), 'orbit-rst-fail-'));
    const driverStore = new Map<string, Uint8Array>();
    const driver = createMockDriver(driverStore);

    try {
      const backupResult = await createBackup({
        destinationDir: tempBackupDir,
        databaseUrl,
        storageDriver: driver,
        pgDumpPath: resolvedPgDump,
      });

      const targetIdentity = computeRestoreTargetIdentity(
        databaseUrl,
        process.env['S3_BUCKET'],
      ).identity;

      await expect(
        restoreBackup({
          backupPath: backupResult.backupDir,
          databaseUrl,
          confirmDestructiveRestoreTarget: targetIdentity,
          storageDriver: driver,
          pgRestorePath: resolvedPgRestore,
          redisUrl: 'redis://127.0.0.1:59999',
          skipRedisCheck: false,
        }),
      ).rejects.toThrow();

      const failedState = await getRecoveryState(databaseUrl);
      expect(failedState?.status).toBe('validation_failed');
    } finally {
      await rm(tempBackupDir, { recursive: true, force: true }).catch(() => undefined);
      await setRecoveryState(databaseUrl, 'ready');
      const cleanupSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await cleanupSql`delete from member where id = ${memberId}`;
        await cleanupSql`delete from "user" where id = ${userId}`;
        await cleanupSql`delete from organization where id = ${orgId}`;
      } finally {
        await cleanupSql.end({ timeout: 5 });
      }
    }
  }, 30_000);

  it('fails restore safely and rejects when lock is lost mid-restore', async () => {
    expect(reachable).toBe(true);

    const tempBackupDir = await mkdtemp(join(tmpdir(), 'orbit-lock-lost-test-'));
    const driverStore = new Map<string, Uint8Array>();
    const driver = createMockDriver(driverStore);
    try {
      const backupResult = await createBackup({
        destinationDir: tempBackupDir,
        databaseUrl,
        storageDriver: driver,
        pgDumpPath: resolvedPgDump,
      });

      const targetIdentity = computeRestoreTargetIdentity(
        databaseUrl,
        process.env['S3_BUCKET'],
      ).identity;

      await expect(
        restoreBackup({
          backupPath: backupResult.backupDir,
          databaseUrl,
          confirmDestructiveRestoreTarget: targetIdentity,
          storageDriver: driver,
          pgRestorePath: resolvedPgRestore,
          skipRedisCheck: true,
          lockMaxLifetime: 1,
        }),
      ).rejects.toThrow(/Restore lock connection was lost unexpectedly/);
    } finally {
      await rm(tempBackupDir, { recursive: true, force: true }).catch(() => undefined);
      await setRecoveryState(databaseUrl, 'ready');
    }
  }, 30_000);
});
