import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BackupManifest,
  backupManifestSchema,
  CURRENT_BACKUP_FORMAT_VERSION,
  extractBackupConfiguration,
  validateConfigurationSafety,
  validationFailed,
} from '@orbit/shared';
import { createStorageDriver, storageDriver } from '../storage/index.ts';
import { dumpDatabase } from './database.ts';
import {
  createEnvelopeDataKey,
  encryptBuffer,
  encryptFile,
  resolveMasterEncryptionKey,
} from './encryption.ts';
import { verifyPreflight } from './preflight.ts';
import { openCoordinatedSnapshot } from './snapshot.ts';
import { captureStorageObjects } from './storage.ts';
import type { BackupCreateOptions, BackupCreateResult } from './types.ts';

function isEncryptionRequested(
  options: BackupCreateOptions,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  return (
    options.encrypt === true ||
    options.encryptionKey !== undefined ||
    options.encryptionKeyFile !== undefined ||
    options.encryptionCommand !== undefined ||
    env['ORBIT_BACKUP_ENCRYPT'] === 'true' ||
    (env['ORBIT_BACKUP_ENCRYPTION_KEY'] !== undefined &&
      env['ORBIT_BACKUP_ENCRYPTION_KEY'].trim().length > 0) ||
    (env['ORBIT_BACKUP_ENCRYPTION_KEY_FILE'] !== undefined &&
      env['ORBIT_BACKUP_ENCRYPTION_KEY_FILE'].trim().length > 0) ||
    (env['ORBIT_BACKUP_ENCRYPTION_COMMAND'] !== undefined &&
      env['ORBIT_BACKUP_ENCRYPTION_COMMAND'].trim().length > 0)
  );
}

interface ProcessedPayload {
  databaseDumpFile: string;
  databaseDumpSha256: string;
  databaseDumpBytes: number;
  databasePlaintextSha256?: string | undefined;
  databasePlaintextBytes?: number | undefined;
  objectsChecksums: BackupManifest['checksums']['objects'];
  encryptionMetadata: BackupManifest['encryption'];
}

async function encryptStoredObjects(
  workingDir: string,
  objects: Awaited<ReturnType<typeof captureStorageObjects>>['objects'],
  dek: Buffer,
): Promise<BackupManifest['checksums']['objects']> {
  const encryptedObjects: BackupManifest['checksums']['objects'] = [];
  for (const obj of objects) {
    const objectPath = join(workingDir, 'objects', obj.key);
    const rawData = await readFile(objectPath);
    const encryptedData = encryptBuffer(rawData, dek);
    await writeFile(objectPath, encryptedData, { mode: 0o600 });
    const encryptedSha256 = createHash('sha256').update(encryptedData).digest('hex');

    encryptedObjects.push({
      key: obj.key,
      sha256: encryptedSha256,
      bytes: encryptedData.byteLength,
      contentType: obj.contentType,
      plaintextSha256: obj.sha256,
      plaintextBytes: obj.bytes,
    });
  }
  return encryptedObjects;
}

async function processPayloadEncryption(
  workingDir: string,
  dumpResult: Awaited<ReturnType<typeof dumpDatabase>>,
  storageResult: Awaited<ReturnType<typeof captureStorageObjects>>,
  options: BackupCreateOptions,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<ProcessedPayload> {
  if (!isEncryptionRequested(options, env)) {
    return {
      databaseDumpFile: dumpResult.file,
      databaseDumpSha256: dumpResult.sha256,
      databaseDumpBytes: dumpResult.bytes,
      objectsChecksums: storageResult.objects.map((obj) => ({
        key: obj.key,
        sha256: obj.sha256,
        bytes: obj.bytes,
        contentType: obj.contentType,
        ...(obj.plaintextSha256 === undefined ? {} : { plaintextSha256: obj.plaintextSha256 }),
        ...(obj.plaintextBytes === undefined ? {} : { plaintextBytes: obj.plaintextBytes }),
      })),
      encryptionMetadata: {
        enabled: false,
      },
    };
  }

  const masterKey = await resolveMasterEncryptionKey({
    key: options.encryptionKey,
    keyFile: options.encryptionKeyFile,
    command: options.encryptionCommand,
    keyId: options.encryptionKeyId,
    env,
  });

  const { dek, envelope } = createEnvelopeDataKey(masterKey.key, masterKey.keyId);

  const dumpPath = join(workingDir, 'database.dump');
  const encryptedDumpPath = join(workingDir, 'database.dump.enc');
  const encryptedDb = await encryptFile(dumpPath, encryptedDumpPath, dek);
  await rm(dumpPath, { force: true });

  const objectsChecksums = await encryptStoredObjects(workingDir, storageResult.objects, dek);

  return {
    databaseDumpFile: 'database.dump.enc',
    databaseDumpSha256: encryptedDb.sha256,
    databaseDumpBytes: encryptedDb.bytes,
    databasePlaintextSha256: dumpResult.sha256,
    databasePlaintextBytes: dumpResult.bytes,
    objectsChecksums,
    encryptionMetadata: {
      enabled: true,
      algorithm: 'aes-256-gcm',
      keyId: envelope.keyId,
      encryptedDek: envelope.encryptedDek,
      dekIv: envelope.dekIv,
      dekTag: envelope.dekTag,
    },
  };
}

export async function createBackup(options: BackupCreateOptions): Promise<BackupCreateResult> {
  const env = options.env ?? process.env;
  const databaseUrl = options.databaseUrl ?? env['DIRECT_URL'] ?? env['DATABASE_URL'];

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw validationFailed('DATABASE_URL or DIRECT_URL is required to create a backup.');
  }

  const destinationDir = options.destinationDir;
  if (destinationDir.length === 0) {
    throw validationFailed('Destination directory path must not be empty.');
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
    let storageResult: Awaited<ReturnType<typeof captureStorageObjects>>;
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

      const driver =
        options.storageDriver ??
        (options.env === undefined
          ? storageDriver()
          : createStorageDriver(options.env as NodeJS.ProcessEnv));
      storageResult = await captureStorageObjects({
        records: snapshot.records,
        outputObjectsDir: join(workingDir, 'objects'),
        driver,
      });
    } finally {
      await snapshot.release();
    }

    const configuration = extractBackupConfiguration(env);
    validateConfigurationSafety(configuration);

    const processed = await processPayloadEncryption(
      workingDir,
      dumpResult,
      storageResult,
      options,
      env,
    );

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
          file: processed.databaseDumpFile,
          sha256: processed.databaseDumpSha256,
          bytes: processed.databaseDumpBytes,
          ...(processed.databasePlaintextSha256 === undefined
            ? {}
            : { plaintextSha256: processed.databasePlaintextSha256 }),
          ...(processed.databasePlaintextBytes === undefined
            ? {}
            : { plaintextBytes: processed.databasePlaintextBytes }),
        },
        objects: processed.objectsChecksums,
      },
      counts: dumpResult.counts,
      encryption: processed.encryptionMetadata,
      metadata: {
        ...(options.customMetadata ?? {}),
        generator: 'orbit-backup-create',
        boundedConsistencyModel: 'postgres-snapshot-coordinated-object-capture',
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
