import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BackupManifest, validationFailed } from '@orbit/shared';

export interface ChecksumsVerificationResult {
  readonly databaseDumpVerified: boolean;
  readonly objectsCount: number;
}

export async function verifyPreMutationChecksums(
  backupDir: string,
  manifest: BackupManifest,
): Promise<ChecksumsVerificationResult> {
  const dumpPath = join(backupDir, manifest.checksums.databaseDump.file);
  let dumpBytes: Buffer;
  try {
    dumpBytes = await readFile(dumpPath);
  } catch (error) {
    throw validationFailed(
      `Database dump file "${manifest.checksums.databaseDump.file}" is missing from backup directory: ${dumpPath}`,
      { cause: error },
    );
  }

  if (dumpBytes.byteLength !== manifest.checksums.databaseDump.bytes) {
    throw validationFailed(
      `Database dump size mismatch: expected ${manifest.checksums.databaseDump.bytes} bytes, found ${dumpBytes.byteLength} bytes.`,
    );
  }

  const dumpSha256 = createHash('sha256').update(dumpBytes).digest('hex');
  if (dumpSha256.toLowerCase() !== manifest.checksums.databaseDump.sha256.toLowerCase()) {
    throw validationFailed(
      `Database dump checksum mismatch: expected ${manifest.checksums.databaseDump.sha256}, found ${dumpSha256}.`,
    );
  }

  for (const objectEntry of manifest.checksums.objects) {
    const objectPath = join(backupDir, 'objects', objectEntry.key);
    let objBytes: Buffer;
    try {
      objBytes = await readFile(objectPath);
    } catch (error) {
      throw validationFailed(
        `Referenced backup object "${objectEntry.key}" is missing from objects directory: ${objectPath}`,
        { cause: error },
      );
    }

    if (objBytes.byteLength !== objectEntry.bytes) {
      throw validationFailed(
        `Backup object "${objectEntry.key}" size mismatch: expected ${objectEntry.bytes} bytes, found ${objBytes.byteLength} bytes.`,
      );
    }

    const objSha256 = createHash('sha256').update(objBytes).digest('hex');
    if (objSha256.toLowerCase() !== objectEntry.sha256.toLowerCase()) {
      throw validationFailed(
        `Backup object "${objectEntry.key}" checksum mismatch: expected ${objectEntry.sha256}, found ${objSha256}.`,
      );
    }
  }

  return {
    databaseDumpVerified: true,
    objectsCount: manifest.checksums.objects.length,
  };
}
