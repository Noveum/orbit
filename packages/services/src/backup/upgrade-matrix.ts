import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogDriftBetween, expectedCatalog, isBehind, liveCatalog } from '@orbit/db/check-drift';
import { releaseDatabase } from '@orbit/db/migration-release';
import * as schema from '@orbit/db/schema';
import { CURRENT_BACKUP_FORMAT_VERSION, validationFailed } from '@orbit/shared';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { verifyBackupCompatibility } from './compatibility.ts';
import { createBackup } from './create.ts';
import { restoreBackup } from './restore.ts';
import type { UpgradeMatrixOptions, UpgradeMatrixResult, UpgradeScenarioResult } from './types.ts';

function defaultMigrationsFolder(customPath: string | undefined): string {
  return customPath ?? fileURLToPath(new URL('../../../db/drizzle', import.meta.url));
}

async function checkCatalogDriftSafe(databaseUrl: string): Promise<boolean> {
  const live = await liveCatalog(databaseUrl);
  const drift = catalogDriftBetween(expectedCatalog(schema), live);
  return !isBehind(drift);
}

export async function runScenarioFreshInstall(
  databaseUrl: string,
  migrationsFolder: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = '/postgres';
  const admin = postgres(maintenanceUrl.toString(), { max: 1, prepare: false, connect_timeout: 5 });
  const databaseName = `orbit_matrix_fresh_${randomBytes(12).toString('hex')}`;
  const freshUrl = new URL(databaseUrl);
  freshUrl.pathname = `/${databaseName}`;
  let created = false;

  try {
    await admin`create database ${admin(databaseName)} template template0`;
    created = true;
    const fresh = postgres(freshUrl.toString(), { max: 1, prepare: false });
    let startedEmpty = false;
    try {
      const [row] = await fresh<{ count: number }[]>`
        select count(*)::int as count from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
      `;
      startedEmpty = row?.count === 0;
    } finally {
      await fresh.end();
    }
    if (!startedEmpty) throw validationFailed('Fresh install database was not empty.');
    const release = await releaseDatabase(freshUrl.toString(), folder);
    if (release.mode !== 'migrated' || release.applied === 0 || release.applied !== release.total) {
      throw validationFailed('Fresh install did not apply every committed migration.');
    }
    const driftOk = await checkCatalogDriftSafe(freshUrl.toString());
    if (!driftOk) {
      throw validationFailed(
        'Fresh install catalog drift check detected missing or incompatible schema.',
      );
    }

    return {
      id: 'fresh_install',
      name: 'Scenario 1: Fresh Installation',
      passed: true,
      durationMs: Math.round(performance.now() - start),
      details: {
        driftOk,
        startedEmpty,
        appliedMigrations: release.applied,
        totalMigrations: release.total,
      },
    };
  } catch (error) {
    return {
      id: 'fresh_install',
      name: 'Scenario 1: Fresh Installation',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      if (created) await admin`drop database ${admin(databaseName)} with (force)`;
    } finally {
      await admin.end();
    }
  }
}

export async function runScenarioBackupRestore(
  databaseUrl: string,
  migrationsFolder: string | undefined,
  confirmDestructiveTarget?: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  if (confirmDestructiveTarget === undefined || confirmDestructiveTarget.length === 0) {
    return {
      id: 'backup_restore',
      name: 'Scenario 2: Backup and Restore Verification',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: 'confirmDestructiveTarget is required for destructive restore scenario.',
    };
  }

  const folder = defaultMigrationsFolder(migrationsFolder);
  const tempDir = await mkdtemp(join(tmpdir(), 'orbit-matrix-br-'));
  const encryptionKey = randomBytes(32).toString('hex');

  try {
    const backupResult = await createBackup({
      destinationDir: tempDir,
      databaseUrl,
      encrypt: true,
      encryptionKey,
      migrationsFolder: folder,
    });

    const restoreResult = await restoreBackup({
      backupPath: backupResult.backupDir,
      confirmDestructiveRestoreTarget: confirmDestructiveTarget,
      databaseUrl,
      encryptionKey,
      skipObjectRestore: true,
      skipRedisCheck: true,
      migrationsFolder: folder,
    });

    await releaseDatabase(databaseUrl, folder);
    const driftOk = await checkCatalogDriftSafe(databaseUrl);

    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);

    return {
      id: 'backup_restore',
      name: 'Scenario 2: Backup and Restore Verification',
      passed: restoreResult.databaseRestored && driftOk,
      durationMs: Math.round(performance.now() - start),
      details: { databaseRestored: restoreResult.databaseRestored, driftOk },
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return {
      id: 'backup_restore',
      name: 'Scenario 2: Backup and Restore Verification',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScenarioUnsafeRollbackRefusal(
  migrationsFolder: string | undefined,
): Promise<UpgradeScenarioResult> {
  await Promise.resolve();
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);
  const committedMigrations = readMigrationFiles({ migrationsFolder: folder });

  try {
    let refusalCaught = false;

    const futureLedger = [
      ...committedMigrations.map((m) => ({ hash: m.hash, createdAt: String(m.folderMillis) })),
      { hash: 'future-hash-xyz-999', createdAt: '9999999999999' },
    ];

    const fakeManifest: import('@orbit/shared').BackupManifest = {
      formatVersion: CURRENT_BACKUP_FORMAT_VERSION,
      orbitVersion: '99.0.0',
      sourceRevision: 'fake-future-rev',
      imageDigests: {},
      databaseVersion: 'PostgreSQL 16.0',
      createdAt: new Date().toISOString(),
      migrationLedger: futureLedger,
      configuration: {},
      checksums: {
        databaseDump: { file: 'database.dump', sha256: 'abc', bytes: 100 },
        objects: [],
      },
      counts: { workspaces: 1, users: 1, attachments: 0, issues: 1 },
      encryption: { enabled: false },
      metadata: {},
    };

    try {
      verifyBackupCompatibility(fakeManifest, folder);
    } catch (compatErr) {
      const message = String(compatErr);
      if (message.includes('unsupported downgrade') || message.includes('downgrade')) {
        refusalCaught = true;
      }
    }

    let futureFormatCaught = false;
    const futureFormatManifest = {
      ...fakeManifest,
      formatVersion: '999.0.0',
      migrationLedger: [],
    } as unknown as import('@orbit/shared').BackupManifest;
    try {
      verifyBackupCompatibility(futureFormatManifest, folder);
    } catch (formatErr) {
      const msg = String(formatErr);
      if (msg.includes('Unsupported backup format version')) {
        futureFormatCaught = true;
      }
    }

    const passed = refusalCaught && futureFormatCaught;

    return {
      id: 'unsafe_rollback_refusal',
      name: 'Scenario 3: Explicit Refusal of Downgrades and Incompatible Formats',
      passed,
      durationMs: Math.round(performance.now() - start),
      details: { refusalCaught, futureFormatCaught },
    };
  } catch (error) {
    return {
      id: 'unsafe_rollback_refusal',
      name: 'Scenario 3: Explicit Refusal of Downgrades and Incompatible Formats',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runUpgradeMatrix(
  options: UpgradeMatrixOptions,
): Promise<UpgradeMatrixResult> {
  const databaseUrl = options.databaseUrl;
  const folder = options.migrationsFolder;
  const target = options.scenario;
  const scenarios: UpgradeScenarioResult[] = [];
  const matrixStart = performance.now();

  const entries: readonly [string, () => Promise<UpgradeScenarioResult>][] = [
    ['fresh_install', () => runScenarioFreshInstall(databaseUrl, folder)],
    [
      'backup_restore',
      () =>
        options.skipDestructive === true
          ? Promise.resolve({
              id: 'backup_restore' as const,
              name: 'Scenario 2: Backup and Restore Verification',
              passed: true,
              skipped: true,
              durationMs: 0,
              details: { skipped: true },
            })
          : runScenarioBackupRestore(databaseUrl, folder, options.confirmDestructiveTarget),
    ],
    ['unsafe_rollback_refusal', () => runScenarioUnsafeRollbackRefusal(folder)],
  ];

  for (const [id, runner] of entries) {
    if (target === undefined || target === id) {
      scenarios.push(await runner());
    }
  }

  const allPassed = scenarios.every((s) => s.passed);
  const totalDurationMs = Math.round(performance.now() - matrixStart);

  return {
    allPassed,
    scenarios,
    totalDurationMs,
  };
}
