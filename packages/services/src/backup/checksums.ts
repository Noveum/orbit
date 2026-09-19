import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, lstat, open } from 'node:fs/promises';
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

export async function assertNoSymlinkPath(baseDir: string, relativePath: string): Promise<string> {
  const resolvedTarget = assertContainedPath(baseDir, relativePath);
  const segments = relativePath.split(/[/\\]+/).filter(Boolean);
  let current = resolve(baseDir);
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw validationFailed(`Symlink paths are not permitted in backups: ${relativePath}`);
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
  return resolvedTarget;
}

export async function openValidatedFile(
  baseDir: string,
  relativePath: string,
): Promise<FileHandle> {
  const resolvedTarget = await assertNoSymlinkPath(baseDir, relativePath);
  const flags = (constants.O_NOFOLLOW ?? 0) | constants.O_RDONLY;
  let handle: FileHandle;
  try {
    handle = await open(resolvedTarget, flags);
  } catch (error) {
    if ((error as { code?: string }).code === 'ELOOP') {
      throw validationFailed(`Symlink paths are not permitted in backups: ${relativePath}`, {
        cause: error,
      });
    }
    throw error;
  }

  const stat = await handle.stat();
  if (!stat.isFile()) {
    await handle.close();
    throw validationFailed(`Backup target is not a regular file: ${relativePath}`);
  }

  const leafStat = await lstat(resolvedTarget);
  if (leafStat.isSymbolicLink()) {
    await handle.close();
    throw validationFailed(`Symlink paths are not permitted in backups: ${relativePath}`);
  }

  return handle;
}

export function computeHandleChecksum(
  handle: FileHandle,
): Promise<{ bytes: number; sha256: string }> {
  return new Promise((resolveResult, rejectResult) => {
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = handle.createReadStream();
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
  let dumpHandle: FileHandle;
  try {
    dumpHandle = await openValidatedFile(backupDir, manifest.checksums.databaseDump.file);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw validationFailed(
        `Database dump file "${manifest.checksums.databaseDump.file}" is missing from backup directory: ${dumpPath}`,
        { cause: error },
      );
    }
    throw error;
  }

  let dumpResult: { bytes: number; sha256: string };
  try {
    dumpResult = await computeHandleChecksum(dumpHandle);
  } finally {
    await dumpHandle.close();
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
    let objHandle: FileHandle;
    try {
      objHandle = await openValidatedFile(join(backupDir, 'objects'), objectEntry.key);
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        throw validationFailed(
          `Referenced backup object "${objectEntry.key}" is missing from objects directory: ${objectPath}`,
          { cause: error },
        );
      }
      throw error;
    }

    let objResult: { bytes: number; sha256: string };
    try {
      objResult = await computeHandleChecksum(objHandle);
    } finally {
      await objHandle.close();
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
