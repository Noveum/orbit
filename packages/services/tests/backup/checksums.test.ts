import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BackupManifest } from '@orbit/shared';
import { verifyPreMutationChecksums } from '../../src/backup/checksums.ts';

async function createTempBackupDirectory(options?: {
  readonly corruptDumpHash?: boolean;
  readonly corruptDumpSize?: boolean;
  readonly deleteDump?: boolean;
  readonly corruptObjectHash?: boolean;
  readonly deleteObject?: boolean;
}): Promise<{
  readonly tempDir: string;
  readonly manifest: BackupManifest;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'orbit-checksums-test-'));

  const dumpContent = new TextEncoder().encode('valid-database-dump-bytes-payload');
  const dumpSha256 = createHash('sha256').update(dumpContent).digest('hex');

  const objectKey = 'org_abc/issue/att_123/image.png';
  const objectContent = new TextEncoder().encode('valid-storage-object-bytes-payload');
  const objectSha256 = createHash('sha256').update(objectContent).digest('hex');

  const dumpFilePath = join(tempDir, 'database.dump');
  if (!options?.deleteDump) {
    let payload = dumpContent;
    if (options?.corruptDumpSize) {
      payload = new TextEncoder().encode('short');
    } else if (options?.corruptDumpHash) {
      const flipped = new Uint8Array(dumpContent);
      flipped[0] = (flipped[0] ?? 0) ^ 1;
      payload = flipped;
    }
    await writeFile(dumpFilePath, payload);
  }

  const objectFilePath = join(tempDir, 'objects', objectKey);
  if (!options?.deleteObject) {
    await mkdir(dirname(objectFilePath), { recursive: true });
    let payload = objectContent;
    if (options?.corruptObjectHash) {
      const flipped = new Uint8Array(objectContent);
      flipped[0] = (flipped[0] ?? 0) ^ 1;
      payload = flipped;
    }
    await writeFile(objectFilePath, payload);
  }

  const manifest: BackupManifest = {
    formatVersion: '1.0.0',
    orbitVersion: '0.1.0',
    sourceRevision: 'abc',
    imageDigests: {},
    databaseVersion: 'PostgreSQL 16.4',
    createdAt: new Date().toISOString(),
    migrationLedger: [],
    configuration: {},
    checksums: {
      databaseDump: {
        file: 'database.dump',
        sha256: dumpSha256,
        bytes: dumpContent.byteLength,
      },
      objects: [
        {
          key: objectKey,
          sha256: objectSha256,
          bytes: objectContent.byteLength,
          contentType: 'image/png',
        },
      ],
    },
    counts: {
      workspaces: 1,
      users: 1,
      attachments: 1,
      issues: 0,
    },
    encryption: {
      enabled: false,
    },
    metadata: {},
  };

  return { tempDir, manifest };
}

describe('verifyPreMutationChecksums', () => {
  it('succeeds when dump and objects match byte counts and sha256 hashes', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory();
    try {
      const result = await verifyPreMutationChecksums(tempDir, manifest);
      expect(result.databaseDumpVerified).toBe(true);
      expect(result.objectsCount).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when database dump is missing', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory({ deleteDump: true });
    try {
      await expect(verifyPreMutationChecksums(tempDir, manifest)).rejects.toThrow(
        /Database dump file "database.dump" is missing/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when database dump size mismatches', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory({ corruptDumpSize: true });
    try {
      await expect(verifyPreMutationChecksums(tempDir, manifest)).rejects.toThrow(
        /Database dump size mismatch/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when database dump sha256 checksum mismatches', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory({ corruptDumpHash: true });
    try {
      await expect(verifyPreMutationChecksums(tempDir, manifest)).rejects.toThrow(
        /Database dump checksum mismatch/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when an object file is missing', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory({ deleteObject: true });
    try {
      await expect(verifyPreMutationChecksums(tempDir, manifest)).rejects.toThrow(
        /is missing from objects directory/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when an object sha256 checksum mismatches', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory({ corruptObjectHash: true });
    try {
      await expect(verifyPreMutationChecksums(tempDir, manifest)).rejects.toThrow(
        /Backup object .* checksum mismatch/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when database dump path attempts traversal', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory();
    try {
      const traversalManifest = {
        ...manifest,
        checksums: {
          ...manifest.checksums,
          databaseDump: {
            ...manifest.checksums.databaseDump,
            file: '../escaped.dump',
          },
        },
      };
      await expect(verifyPreMutationChecksums(tempDir, traversalManifest)).rejects.toThrow(
        /Path escapes directory/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when object key attempts traversal', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory();
    try {
      const traversalManifest = {
        ...manifest,
        checksums: {
          ...manifest.checksums,
          objects: [
            {
              key: '../../etc/passwd',
              bytes: 10,
              sha256: 'abc',
              contentType: 'text/plain',
            },
          ],
        },
      };
      await expect(verifyPreMutationChecksums(tempDir, traversalManifest)).rejects.toThrow(
        /Path escapes directory/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when database dump path is a symlink', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory();
    try {
      const realDump = join(tempDir, 'database.dump');
      const linkDump = join(tempDir, 'symlink.dump');
      try {
        await symlink(realDump, linkDump);
      } catch {
        return;
      }
      const symlinkManifest = {
        ...manifest,
        checksums: {
          ...manifest.checksums,
          databaseDump: {
            ...manifest.checksums.databaseDump,
            file: 'symlink.dump',
          },
        },
      };
      await expect(verifyPreMutationChecksums(tempDir, symlinkManifest)).rejects.toThrow(
        /Symlink paths are not permitted/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when object path is a symlink', async () => {
    const { tempDir, manifest } = await createTempBackupDirectory();
    try {
      const realObj = join(tempDir, 'objects', 'org_abc/issue/att_123/image.png');
      const linkObj = join(tempDir, 'objects', 'symlink.png');
      try {
        await symlink(realObj, linkObj);
      } catch {
        return;
      }
      const symlinkManifest = {
        ...manifest,
        checksums: {
          ...manifest.checksums,
          objects: [
            {
              key: 'symlink.png',
              bytes: manifest.checksums.objects[0]?.bytes ?? 0,
              sha256: manifest.checksums.objects[0]?.sha256 ?? '',
              contentType: 'image/png',
            },
          ],
        },
      };
      await expect(verifyPreMutationChecksums(tempDir, symlinkManifest)).rejects.toThrow(
        /Symlink paths are not permitted/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
