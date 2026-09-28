import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '@orbit/shared';
import { captureStorageObjects } from '../../src/backup/storage.ts';
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

describe('captureStorageObjects', () => {
  it('captures referenced storage objects into destination directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-storage-test-'));
    try {
      const testBytes = new TextEncoder().encode('hello world backup storage content');
      const expectedSha256 = createHash('sha256').update(testBytes).digest('hex');
      const testKey = 'org_test/issue/att_123/file.txt';

      const store = new Map<string, Uint8Array>([[testKey, testBytes]]);
      const driver = createMockDriver(store);
      const result = await captureStorageObjects({
        records: [
          {
            id: 'att-123',
            storage_key: testKey,
            size: testBytes.byteLength,
            content_type: 'text/plain',
          },
        ],
        outputObjectsDir: tempDir,
        driver,
      });

      expect(Array.isArray(result.objects)).toBe(true);
      expect(result.objects.length).toBe(1);
      expect(result.objects[0]?.key).toBe(testKey);
      expect(result.objects[0]?.sha256).toBe(expectedSha256);
      expect(result.objects[0]?.bytes).toBe(testBytes.byteLength);
      expect(result.objects[0]?.contentType).toBe('text/plain');

      const written = await readFile(join(tempDir, testKey));
      expect(new Uint8Array(written)).toEqual(testBytes);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws descriptive error when referenced object is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-missing-test-'));
    try {
      const testKey = `test-missing-${Date.now()}`;
      const store = new Map<string, Uint8Array>();
      const driver = createMockDriver(store);

      let thrownError: unknown;
      try {
        await captureStorageObjects({
          records: [
            {
              id: 'att-missing-1',
              storage_key: testKey,
              size: 10,
              content_type: 'text/plain',
            },
          ],
          outputObjectsDir: tempDir,
          driver,
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(DomainError);
      expect((thrownError as DomainError).message).toContain(testKey);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
