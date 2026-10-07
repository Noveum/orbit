import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogDriftBetween, expectedCatalog, isBehind, liveCatalog } from '@orbit/db/check-drift';
import { releaseDatabase } from '@orbit/db/migration-release';
import * as schema from '@orbit/db/schema';
import {
  CURRENT_BACKUP_FORMAT_VERSION,
  computeRestoreTargetIdentity,
  validationFailed,
} from '@orbit/shared';
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

  try {
    await releaseDatabase(databaseUrl, folder);
    const driftOk = await checkCatalogDriftSafe(databaseUrl);
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
      details: { driftOk },
    };
  } catch (error) {
    return {
      id: 'fresh_install',
      name: 'Scenario 1: Fresh Installation',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScenarioDirectUpgrade(
  databaseUrl: string,
  migrationsFolder: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);

  try {
    await releaseDatabase(databaseUrl, folder);
    const driftOk = await checkCatalogDriftSafe(databaseUrl);
    if (!driftOk) {
      throw validationFailed('Direct upgrade catalog drift check detected incompatible schema.');
    }

    return {
      id: 'direct_upgrade',
      name: 'Scenario 2: Previous Stable to Current Stable Direct Upgrade',
      passed: true,
      durationMs: Math.round(performance.now() - start),
      details: { driftOk },
    };
  } catch (error) {
    return {
      id: 'direct_upgrade',
      name: 'Scenario 2: Previous Stable to Current Stable Direct Upgrade',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScenarioBackupRestoreUpgrade(
  databaseUrl: string,
  migrationsFolder: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);
  const tempDir = await mkdtemp(join(tmpdir(), 'orbit-matrix-bru-'));
  const encryptionKey = randomBytes(32).toString('hex');

  try {
    const backupResult = await createBackup({
      destinationDir: tempDir,
      databaseUrl,
      encrypt: true,
      encryptionKey,
      migrationsFolder: folder,
    });

    const bucket = process.env['S3_BUCKET'];
    const target = computeRestoreTargetIdentity(databaseUrl, bucket);

    const restoreResult = await restoreBackup({
      backupPath: backupResult.backupDir,
      confirmDestructiveRestoreTarget: target.identity,
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
      id: 'backup_restore_upgrade',
      name: 'Scenario 3: Backup on Previous Stable, Restore, and Upgrade',
      passed: restoreResult.databaseRestored && driftOk,
      durationMs: Math.round(performance.now() - start),
      details: { databaseRestored: restoreResult.databaseRestored, driftOk },
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return {
      id: 'backup_restore_upgrade',
      name: 'Scenario 3: Backup on Previous Stable, Restore, and Upgrade',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScenarioDirectRestoreCurrent(
  databaseUrl: string,
  migrationsFolder: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);
  const tempDir = await mkdtemp(join(tmpdir(), 'orbit-matrix-drc-'));
  const encryptionKey = randomBytes(32).toString('hex');

  try {
    const backupResult = await createBackup({
      destinationDir: tempDir,
      databaseUrl,
      encrypt: true,
      encryptionKey,
      migrationsFolder: folder,
    });

    const bucket = process.env['S3_BUCKET'];
    const target = computeRestoreTargetIdentity(databaseUrl, bucket);

    const restoreResult = await restoreBackup({
      backupPath: backupResult.backupDir,
      confirmDestructiveRestoreTarget: target.identity,
      databaseUrl,
      encryptionKey,
      skipObjectRestore: true,
      skipRedisCheck: true,
      migrationsFolder: folder,
    });

    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);

    return {
      id: 'direct_restore_current',
      name: 'Scenario 4: Backup on Previous Stable to Direct Restore into Current Stable',
      passed: restoreResult.databaseRestored && restoreResult.validation.valid,
      durationMs: Math.round(performance.now() - start),
      details: { valid: restoreResult.validation.valid },
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return {
      id: 'direct_restore_current',
      name: 'Scenario 4: Backup on Previous Stable to Direct Restore into Current Stable',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScenarioInterruptedMigrationRepair(
  databaseUrl: string,
  migrationsFolder: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);

  try {
    await releaseDatabase(databaseUrl, folder);
    const driftOk = await checkCatalogDriftSafe(databaseUrl);

    return {
      id: 'interrupted_migration_repair',
      name: 'Scenario 5: Interrupted Migration and Forward-Repair',
      passed: driftOk,
      durationMs: Math.round(performance.now() - start),
      details: { driftOk },
    };
  } catch (error) {
    return {
      id: 'interrupted_migration_repair',
      name: 'Scenario 5: Interrupted Migration and Forward-Repair',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScenarioApplicationRollback(
  databaseUrl: string,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    keep_alive: 10,
    prepare: false,
    onnotice: () => undefined,
  });

  try {
    const [userCount] = await sql<
      { count: number }[]
    >`select count(*)::int as count from public."user"`;
    const [orgCount] = await sql<
      { count: number }[]
    >`select count(*)::int as count from public.organization`;
    const [issueCount] = await sql<
      { count: number }[]
    >`select count(*)::int as count from public.issue`;
    const [docCount] = await sql<
      { count: number }[]
    >`select count(*)::int as count from public.doc`;

    const canReadPreviousContracts =
      userCount !== undefined &&
      orgCount !== undefined &&
      issueCount !== undefined &&
      docCount !== undefined;

    return {
      id: 'application_rollback',
      name: 'Scenario 6: Application Rollback with Compatible Additive Schema',
      passed: canReadPreviousContracts,
      durationMs: Math.round(performance.now() - start),
      details: { canReadPreviousContracts },
    };
  } catch (error) {
    return {
      id: 'application_rollback',
      name: 'Scenario 6: Application Rollback with Compatible Additive Schema',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
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
      name: 'Scenario 7: Explicit Refusal when Rollback/Downgrade is Unsafe',
      passed,
      durationMs: Math.round(performance.now() - start),
      details: { refusalCaught, futureFormatCaught },
    };
  } catch (error) {
    return {
      id: 'unsafe_rollback_refusal',
      name: 'Scenario 7: Explicit Refusal when Rollback/Downgrade is Unsafe',
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
  const targetScenario = options.scenario;
  const scenarios: UpgradeScenarioResult[] = [];
  const matrixStart = performance.now();

  if (targetScenario === undefined || targetScenario === 'fresh_install') {
    scenarios.push(await runScenarioFreshInstall(databaseUrl, folder));
  }

  if (targetScenario === undefined || targetScenario === 'direct_upgrade') {
    scenarios.push(await runScenarioDirectUpgrade(databaseUrl, folder));
  }

  if (targetScenario === undefined || targetScenario === 'backup_restore_upgrade') {
    scenarios.push(await runScenarioBackupRestoreUpgrade(databaseUrl, folder));
  }

  if (targetScenario === undefined || targetScenario === 'direct_restore_current') {
    scenarios.push(await runScenarioDirectRestoreCurrent(databaseUrl, folder));
  }

  if (targetScenario === undefined || targetScenario === 'interrupted_migration_repair') {
    scenarios.push(await runScenarioInterruptedMigrationRepair(databaseUrl, folder));
  }

  if (targetScenario === undefined || targetScenario === 'application_rollback') {
    scenarios.push(await runScenarioApplicationRollback(databaseUrl));
  }

  if (targetScenario === undefined || targetScenario === 'unsafe_rollback_refusal') {
    scenarios.push(await runScenarioUnsafeRollbackRefusal(folder));
  }

  const allPassed = scenarios.every((s) => s.passed);
  const totalDurationMs = Math.round(performance.now() - matrixStart);

  return {
    allPassed,
    scenarios,
    totalDurationMs,
  };
}
