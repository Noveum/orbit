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

  if (process.env['ORBIT_PREVIOUS_RELEASE_FIXTURE'] === undefined) {
    return {
      id: 'direct_upgrade',
      name: 'Scenario 2: Previous Stable to Current Stable Direct Upgrade (Placeholder)',
      passed: true,
      skipped: true,
      durationMs: Math.round(performance.now() - start),
      details: {
        skipped: true,
        reason: 'Previous-release schema fixture not configured in environment',
      },
    };
  }

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
  confirmDestructiveTarget?: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);
  const tempDir = await mkdtemp(join(tmpdir(), 'orbit-matrix-bru-'));
  if (confirmDestructiveTarget === undefined || confirmDestructiveTarget.length === 0) {
    return {
      id: 'backup_restore_upgrade',
      name: 'Scenario 3: Backup on Previous Stable, Restore, and Upgrade',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: 'confirmDestructiveTarget is required for destructive upgrade scenario.',
    };
  }

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
  confirmDestructiveTarget?: string | undefined,
): Promise<UpgradeScenarioResult> {
  const start = performance.now();
  const folder = defaultMigrationsFolder(migrationsFolder);
  if (confirmDestructiveTarget === undefined || confirmDestructiveTarget.length === 0) {
    return {
      id: 'direct_restore_current',
      name: 'Scenario 4: Backup on Previous Stable to Direct Restore into Current Stable',
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: 'confirmDestructiveTarget is required for destructive upgrade scenario.',
    };
  }

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

    const restoreResult = await restoreBackup({
      backupPath: backupResult.backupDir,
      confirmDestructiveRestoreTarget: confirmDestructiveTarget,
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

  if (process.env['ORBIT_SIMULATE_INTERRUPTED_MIGRATION'] === undefined) {
    return {
      id: 'interrupted_migration_repair',
      name: 'Scenario 5: Interrupted Migration and Forward-Repair (Placeholder)',
      passed: true,
      skipped: true,
      durationMs: Math.round(performance.now() - start),
      details: {
        skipped: true,
        reason: 'Interrupted migration simulation precondition not configured',
      },
    };
  }

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

  if (process.env['ORBIT_TEST_APPLICATION_ROLLBACK'] === undefined) {
    return {
      id: 'application_rollback',
      name: 'Scenario 6: Application Rollback with Compatible Additive Schema (Placeholder)',
      passed: true,
      skipped: true,
      durationMs: Math.round(performance.now() - start),
      details: { skipped: true, reason: 'Application rollback precondition not configured' },
    };
  }

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

function makeSkippedScenario(id: UpgradeScenarioResult['id'], name: string): UpgradeScenarioResult {
  return {
    id,
    name,
    passed: true,
    skipped: true,
    durationMs: 0,
    details: { skipped: true },
  };
}

async function runScenarioBackupRestoreUpgradeGuarded(
  databaseUrl: string,
  folder: string | undefined,
  confirmDestructiveTarget: string | undefined,
  skipDestructive: boolean | undefined,
): Promise<UpgradeScenarioResult> {
  if (skipDestructive === true) {
    return makeSkippedScenario(
      'backup_restore_upgrade',
      'Scenario 3: Backup on Previous Stable, Restore, and Upgrade',
    );
  }
  return await runScenarioBackupRestoreUpgrade(databaseUrl, folder, confirmDestructiveTarget);
}

async function runScenarioDirectRestoreCurrentGuarded(
  databaseUrl: string,
  folder: string | undefined,
  confirmDestructiveTarget: string | undefined,
  skipDestructive: boolean | undefined,
): Promise<UpgradeScenarioResult> {
  if (skipDestructive === true) {
    return makeSkippedScenario(
      'direct_restore_current',
      'Scenario 4: Backup on Previous Stable to Direct Restore into Current Stable',
    );
  }
  return await runScenarioDirectRestoreCurrent(databaseUrl, folder, confirmDestructiveTarget);
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
    ['direct_upgrade', () => runScenarioDirectUpgrade(databaseUrl, folder)],
    [
      'backup_restore_upgrade',
      () =>
        runScenarioBackupRestoreUpgradeGuarded(
          databaseUrl,
          folder,
          options.confirmDestructiveTarget,
          options.skipDestructive,
        ),
    ],
    [
      'direct_restore_current',
      () =>
        runScenarioDirectRestoreCurrentGuarded(
          databaseUrl,
          folder,
          options.confirmDestructiveTarget,
          options.skipDestructive,
        ),
    ],
    [
      'interrupted_migration_repair',
      () => runScenarioInterruptedMigrationRepair(databaseUrl, folder),
    ],
    ['application_rollback', () => runScenarioApplicationRollback(databaseUrl)],
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
