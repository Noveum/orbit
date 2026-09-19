import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '@orbit/db/migration-release';
import {
  type BackupManifest,
  backupManifestSchema,
  internal,
  validationFailed,
} from '@orbit/shared';
import { createStorageDriver } from '../storage/index.ts';
import type { StorageDriver } from '../storage/types.ts';
import { assertNoSymlinkPath, verifyPreMutationChecksums } from './checksums.ts';
import { verifyBackupCompatibility } from './compatibility.ts';
import { acquireRestoreLock, setRecoveryState } from './readiness.ts';
import { restoreDatabase } from './restore-database.ts';
import { restoreStorageObjects } from './restore-storage.ts';
import { assertRestoreTargetConfirmed } from './target-guard.ts';
import type { BackupRestoreOptions, BackupRestoreResult } from './types.ts';
import { validateRestore } from './validate.ts';

async function readManifest(
  backupPath: string,
): Promise<{ backupDir: string; manifest: BackupManifest }> {
  const isExplicitJson = backupPath.endsWith('.json');
  const manifestPath = isExplicitJson ? backupPath : join(backupPath, 'manifest.json');
  const backupDir = isExplicitJson ? dirname(backupPath) : backupPath;

  let rawManifestText: string;
  try {
    rawManifestText = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw validationFailed(`Could not read manifest at ${manifestPath}`, { cause: error });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawManifestText);
  } catch (error) {
    throw validationFailed(`Manifest at ${manifestPath} is not valid JSON.`, { cause: error });
  }

  const manifest = backupManifestSchema.parse(parsedJson);
  await assertNoSymlinkPath(backupDir, manifest.checksums.databaseDump.file);
  for (const obj of manifest.checksums.objects) {
    await assertNoSymlinkPath(join(backupDir, 'objects'), obj.key);
  }

  return { backupDir, manifest };
}

function resolveStorageDriver(
  options: BackupRestoreOptions,
  env: NodeJS.ProcessEnv,
): StorageDriver | undefined {
  if (options.skipObjectRestore) {
    return undefined;
  }
  if (options.storageDriver !== undefined) {
    return options.storageDriver;
  }
  return createStorageDriver(env);
}

async function runDatabaseAndMigrations(
  databaseUrl: string,
  backupDir: string,
  manifest: BackupManifest,
  migrationsFolder: string | undefined,
  pgRestorePath: string | undefined,
  pendingMigrationsCount: number,
): Promise<void> {
  const dumpFile = await assertNoSymlinkPath(backupDir, manifest.checksums.databaseDump.file);
  await restoreDatabase({ databaseUrl, dumpFile, pgRestorePath });

  if (pendingMigrationsCount > 0) {
    const folder =
      migrationsFolder ?? fileURLToPath(new URL('../../../db/drizzle', import.meta.url));
    await releaseDatabase(databaseUrl, folder);
  }
}

export async function restoreBackup(options: BackupRestoreOptions): Promise<BackupRestoreResult> {
  const env = options.env ?? process.env;
  const databaseUrl = options.databaseUrl ?? env['DIRECT_URL'] ?? env['DATABASE_URL'];

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw validationFailed('DATABASE_URL or DIRECT_URL is required to restore a backup.');
  }

  const backupPath = options.backupPath.trim();
  if (backupPath.length === 0) {
    throw validationFailed('Backup path must not be empty.');
  }

  const { backupDir, manifest } = await readManifest(backupPath);

  const bucket = env['S3_BUCKET'];
  const target = assertRestoreTargetConfirmed(
    databaseUrl,
    bucket,
    options.confirmDestructiveRestoreTarget,
  );

  const compatibility = verifyBackupCompatibility(manifest, options.migrationsFolder);

  await verifyPreMutationChecksums(backupDir, manifest);

  const driver = resolveStorageDriver(options, env);

  await acquireRestoreLock(databaseUrl);

  try {
    await runDatabaseAndMigrations(
      databaseUrl,
      backupDir,
      manifest,
      options.migrationsFolder,
      options.pgRestorePath,
      compatibility.pendingMigrationsCount,
    );

    let objectsReconciled = 0;
    if (driver !== undefined) {
      const storageResult = await restoreStorageObjects({
        objectsDir: join(backupDir, 'objects'),
        expectedObjects: manifest.checksums.objects,
        driver,
      });
      objectsReconciled = storageResult.uploadedCount + storageResult.verifiedCount;
    }

    const validation = await validateRestore({
      databaseUrl,
      storageDriver: driver,
      migrationsFolder: options.migrationsFolder,
      redisUrl: options.redisUrl ?? env['REDIS_URL'],
      skipRedisCheck: options.skipRedisCheck,
    });

    if (!validation.valid) {
      const errorSummary = validation.errors.join('; ');
      await setRecoveryState(databaseUrl, 'validation_failed', errorSummary);
      throw internal(`Restore validation failed: ${errorSummary}`);
    }

    await setRecoveryState(databaseUrl, 'ready');

    return {
      manifest,
      targetIdentity: target.identity,
      databaseRestored: true,
      objectsReconciled,
      validation,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await setRecoveryState(databaseUrl, 'validation_failed', errorMessage).catch(() => undefined);
    throw error;
  }
}
