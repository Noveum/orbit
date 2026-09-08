import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BackupManifest,
  backupManifestSchema,
  CURRENT_BACKUP_FORMAT_VERSION,
  extractBackupConfiguration,
  validateConfigurationSafety,
} from '@orbit/shared';
import { createStorageDriver, storageDriver } from '../storage/index.ts';
import { dumpDatabase } from './database.ts';
import { verifyPreflight } from './preflight.ts';
import { openCoordinatedSnapshot } from './snapshot.ts';
import { captureStorageObjects } from './storage.ts';
import type { BackupCreateOptions, BackupCreateResult } from './types.ts';

export async function createBackup(options: BackupCreateOptions): Promise<BackupCreateResult> {
  const env = options.env ?? process.env;
  const databaseUrl = options.databaseUrl ?? env['DIRECT_URL'] ?? env['DATABASE_URL'];

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL or DIRECT_URL is required to create a backup.');
  }

  const destinationDir = options.destinationDir;
  if (destinationDir.length === 0) {
    throw new Error('Destination directory path must not be empty.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `orbit-backup-${timestamp}-${randomUUID().slice(0, 8)}`;
  const targetDir = join(destinationDir, backupId);
  const workingDir = join(destinationDir, `${backupId}.tmp`);
  const incompleteDir = join(destinationDir, `${backupId}.incomplete`);

  await mkdir(workingDir, { recursive: true, mode: 0o700 });

  try {
    const preflight = await verifyPreflight(databaseUrl, options.migrationsFolder);

    const snapshot = await openCoordinatedSnapshot(databaseUrl);
    let dumpResult: Awaited<ReturnType<typeof dumpDatabase>>;
    try {
      dumpResult = await dumpDatabase({
        databaseUrl,
        outputFile: join(workingDir, 'database.dump'),
        databaseVersion: preflight.databaseVersion,
        ledger: preflight.ledger,
        pgDumpPath: options.pgDumpPath,
        snapshotId: snapshot.snapshotId,
        counts: snapshot.counts,
      });
    } finally {
      await snapshot.release();
    }

    const driver =
      options.env === undefined
        ? storageDriver()
        : createStorageDriver(options.env as NodeJS.ProcessEnv);
    const storageResult = await captureStorageObjects({
      records: snapshot.records,
      outputObjectsDir: join(workingDir, 'objects'),
      driver,
    });

    const configuration = extractBackupConfiguration(env);
    validateConfigurationSafety(configuration);

    const orbitVersion = options.orbitVersion ?? env['ORBIT_VERSION'] ?? '0.1.0';
    const sourceRevision =
      options.sourceRevision ?? env['SOURCE_REVISION'] ?? env['VERCEL_GIT_COMMIT_SHA'] ?? 'unknown';
    const imageDigests = options.imageDigests ?? {};

    const rawManifest: BackupManifest = {
      formatVersion: CURRENT_BACKUP_FORMAT_VERSION,
      orbitVersion,
      sourceRevision,
      imageDigests,
      databaseVersion: dumpResult.databaseVersion,
      createdAt: new Date().toISOString(),
      migrationLedger: [...dumpResult.migrationLedger],
      configuration,
      checksums: {
        databaseDump: {
          file: dumpResult.file,
          sha256: dumpResult.sha256,
          bytes: dumpResult.bytes,
        },
        objects: [...storageResult.objects],
      },
      counts: dumpResult.counts,
      encryption: {
        enabled: false,
      },
      metadata: {
        generator: 'orbit-backup-create',
        boundedConsistencyModel: 'postgres-snapshot-coordinated-object-capture',
        ...(options.customMetadata ?? {}),
      },
    };

    const manifest = backupManifestSchema.parse(rawManifest);
    await writeFile(join(workingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });

    await rename(workingDir, targetDir);

    return {
      backupId,
      backupDir: targetDir,
      manifest,
    };
  } catch (error) {
    try {
      await rename(workingDir, incompleteDir);
    } catch {
      await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}
