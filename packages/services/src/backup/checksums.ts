import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { type BackupManifest, validationFailed } from '@orbit/shared';

export interface ChecksumsVerificationResult {
  readonly databaseDumpVerified: boolean;
  readonly objectsCount: number;
}

export function assertContainedPath(baseDir: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw validationFailed(`Path must be relative, got absolute path: ${relativePath}`);
  }
  const resolvedBase = resolve(baseDir);
  const resolvedTarget = resolve(baseDir, relativePath);
  if (!resolvedTarget.startsWith(resolvedBase + sep) && resolvedTarget !== resolvedBase) {
    throw validationFailed(`Path escapes directory: ${relativePath}`);
  }
  return resolvedTarget;
}

function computeStreamChecksum(filePath: string): Promise<{ bytes: number; sha256: string }> {
  return new Promise((resolveResult, rejectResult) => {
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.length;
      hash.update(buffer);
    });
    stream.on('end', () => {
      resolveResult({ bytes, sha256: hash.digest('hex') });
    });
    stream.on('error', (error) => {
      rejectResult(error);
    });
  });
}

export async function verifyPreMutationChecksums(
  backupDir: string,
  manifest: BackupManifest,
): Promise<ChecksumsVerificationResult> {
  const dumpPath = assertContainedPath(backupDir, manifest.checksums.databaseDump.file);
  let dumpResult: { bytes: number; sha256: string };
  try {
    dumpResult = await computeStreamChecksum(dumpPath);
  } catch (error) {
    throw validationFailed(
      `Database dump file "${manifest.checksums.databaseDump.file}" is missing from backup directory: ${dumpPath}`,
      { cause: error },
    );
  }

  if (dumpResult.bytes !== manifest.checksums.databaseDump.bytes) {
    throw validationFailed(
      `Database dump size mismatch: expected ${manifest.checksums.databaseDump.bytes} bytes, found ${dumpResult.bytes} bytes.`,
    );
  }

  if (dumpResult.sha256.toLowerCase() !== manifest.checksums.databaseDump.sha256.toLowerCase()) {
    throw validationFailed(
      `Database dump checksum mismatch: expected ${manifest.checksums.databaseDump.sha256}, found ${dumpResult.sha256}.`,
    );
  }

  for (const objectEntry of manifest.checksums.objects) {
    const objectPath = assertContainedPath(join(backupDir, 'objects'), objectEntry.key);
    let objResult: { bytes: number; sha256: string };
    try {
      objResult = await computeStreamChecksum(objectPath);
    } catch (error) {
      throw validationFailed(
        `Referenced backup object "${objectEntry.key}" is missing from objects directory: ${objectPath}`,
        { cause: error },
      );
    }

    if (objResult.bytes !== objectEntry.bytes) {
      throw validationFailed(
        `Backup object "${objectEntry.key}" size mismatch: expected ${objectEntry.bytes} bytes, found ${objResult.bytes} bytes.`,
      );
    }

    if (objResult.sha256.toLowerCase() !== objectEntry.sha256.toLowerCase()) {
      throw validationFailed(
        `Backup object "${objectEntry.key}" checksum mismatch: expected ${objectEntry.sha256}, found ${objResult.sha256}.`,
      );
    }
  }

  return {
    databaseDumpVerified: true,
    objectsCount: manifest.checksums.objects.length,
  };
}
