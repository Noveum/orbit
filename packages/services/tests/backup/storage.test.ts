import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
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
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) return;

    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-storage-test-'));
    try {
      const store = new Map<string, Uint8Array>();
      const driver = createMockDriver(store);
      const result = await captureStorageObjects({
        databaseUrl,
        outputObjectsDir: tempDir,
        driver,
      });

      expect(Array.isArray(result.objects)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws descriptive error when referenced object is missing', async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) return;

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, prepare: false });
    const testKey = `test-missing-${Date.now()}`;
    const testId = `att-test-${Date.now()}`;
    const [userRow] = await sql<{ id: string }[]>`select id from "user" limit 1`;
    const [orgRow] = await sql<{ id: string }[]>`select id from organization limit 1`;

    if (userRow === undefined || orgRow === undefined) {
      await sql.end({ timeout: 5 });
      return;
    }

    await sql`
      insert into attachment (id, organization_id, parent_type, parent_id, file_name, content_type, size, storage_key, status, uploaded_by_id)
      values (${testId}, ${orgRow.id}, 'issue', 'issue-1', 'test.txt', 'text/plain', 10, ${testKey}, 'ready', ${userRow.id})
    `;

    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-missing-test-'));
    try {
      const store = new Map<string, Uint8Array>();
      const driver = createMockDriver(store);

      let thrownError: Error | undefined;
      try {
        await captureStorageObjects({
          databaseUrl,
          outputObjectsDir: tempDir,
          driver,
        });
      } catch (err) {
        thrownError = err as Error;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError?.message).toContain(testKey);
    } finally {
      await sql`delete from attachment where id = ${testId}`;
      await sql.end({ timeout: 5 });
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
