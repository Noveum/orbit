import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { restoreStorageObjects } from '../../src/backup/restore-storage.ts';
import type { StorageDriver, StoredObject, UploadTarget } from '../../src/storage/types.ts';

function createMockDriver(store: Map<string, Uint8Array>): StorageDriver {
  return {
    name: 's3',
    get(key: string): Promise<Uint8Array | null> {
      return Promise.resolve(store.get(key) ?? null);
    },
    put(key: string, body: Uint8Array): Promise<void> {
      store.set(key, body);
      return Promise.resolve();
    },
    stat(key: string): Promise<StoredObject | null> {
      const data = store.get(key);
      if (data === undefined) return Promise.resolve(null);
      return Promise.resolve({
        key,
        size: data.byteLength,
        contentType: 'application/octet-stream',
        updatedAt: new Date(),
      });
    },
    delete(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    summarizePrefix(): Promise<{
      objects: number;
      bytes: number;
      versions: number;
      versionBytes: number;
    }> {
      return Promise.resolve({ objects: 0, bytes: 0, versions: 0, versionBytes: 0 });
    },
    deletePrefix(): Promise<void> {
      return Promise.resolve();
    },
    getUrl(): Promise<string> {
      return Promise.resolve('');
    },
    createUploadTarget(key: string, _contentType: string, maxBytes: number): Promise<UploadTarget> {
      return Promise.resolve({
        key,
        url: 'http://localhost/upload',
        method: 'PUT',
        headers: {},
        maxBytes,
        expiresAt: new Date().toISOString(),
      });
    },
  };
}

describe('restoreStorageObjects', () => {
  it('reconciles storage by uploading missing objects and preserving extras', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-restore-storage-test-'));
    try {
      const key1 = 'org_1/issue/att_1/file1.txt';
      const bytes1 = new TextEncoder().encode('file 1 content');
      const sha1 = createHash('sha256').update(bytes1).digest('hex');

      const key2 = 'org_1/issue/att_2/file2.txt';
      const bytes2 = new TextEncoder().encode('file 2 content updated');
      const sha2 = createHash('sha256').update(bytes2).digest('hex');

      const filePath1 = join(tempDir, key1);
      await mkdir(dirname(filePath1), { recursive: true });
      await writeFile(filePath1, bytes1);

      const filePath2 = join(tempDir, key2);
      await mkdir(dirname(filePath2), { recursive: true });
      await writeFile(filePath2, bytes2);

      const staleBytes2 = new TextEncoder().encode('file 2 old outdated content');
      const extraKey = 'org_other/doc/att_3/extra.txt';
      const extraBytes = new TextEncoder().encode('extra unrelated file');

      const store = new Map<string, Uint8Array>([
        [key2, staleBytes2],
        [extraKey, extraBytes],
      ]);
      const driver = createMockDriver(store);

      const result = await restoreStorageObjects({
        objectsDir: tempDir,
        expectedObjects: [
          { key: key1, sha256: sha1, bytes: bytes1.byteLength, contentType: 'text/plain' },
          { key: key2, sha256: sha2, bytes: bytes2.byteLength, contentType: 'text/plain' },
        ],
        driver,
      });

      expect(result.uploadedCount).toBe(2);
      expect(result.verifiedCount).toBe(0);

      expect(store.get(key1)).toEqual(bytes1);
      expect(store.get(key2)).toEqual(bytes2);
      expect(store.get(extraKey)).toEqual(extraBytes);

      const repeatResult = await restoreStorageObjects({
        objectsDir: tempDir,
        expectedObjects: [
          { key: key1, sha256: sha1, bytes: bytes1.byteLength, contentType: 'text/plain' },
          { key: key2, sha256: sha2, bytes: bytes2.byteLength, contentType: 'text/plain' },
        ],
        driver,
      });

      expect(repeatResult.uploadedCount).toBe(0);
      expect(repeatResult.verifiedCount).toBe(2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects upload when backup object size or checksum mismatches expected', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-restore-storage-mismatch-'));
    try {
      const key = 'org_abc/issue/att_1/file.txt';
      const fileContent = new TextEncoder().encode('valid content');
      const filePath = join(tempDir, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, fileContent);

      const store = new Map<string, Uint8Array>();
      const driver = createMockDriver(store);

      await expect(
        restoreStorageObjects({
          objectsDir: tempDir,
          expectedObjects: [
            { key, sha256: 'wrong_hash', bytes: fileContent.byteLength, contentType: 'text/plain' },
          ],
          driver,
        }),
      ).rejects.toThrow(/checksum mismatch/);

      await expect(
        restoreStorageObjects({
          objectsDir: tempDir,
          expectedObjects: [{ key, sha256: 'some_hash', bytes: 9999, contentType: 'text/plain' }],
          driver,
        }),
      ).rejects.toThrow(/size mismatch/);

      expect(store.size).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
