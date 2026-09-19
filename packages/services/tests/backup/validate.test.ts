import { beforeAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '@orbit/db/migration-release';
import postgres from 'postgres';
import { resolveTestDatabaseUrl } from '../../../../scripts/test-env.ts';
import { validateRestore } from '../../src/backup/validate.ts';
import type { StorageDriver, StoredObject, UploadTarget } from '../../src/storage/types.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

async function isDatabaseReachable(url: string): Promise<boolean> {
  const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 2, prepare: false });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

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

describe('validateRestore', () => {
  const databaseUrl = resolveTestDatabaseUrl('orbit_test_svc');

  let reachable = false;

  beforeAll(async () => {
    reachable = await isDatabaseReachable(databaseUrl);
    expect(reachable).toBe(true);
    await releaseDatabase(databaseUrl, MIGRATIONS);
  });

  it('validates a healthy database and matching storage driver', async () => {
    expect(reachable).toBe(true);
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orgId = `org_val_${stamp}`;
    const userId = `usr_val_${stamp}`;
    const memberId = `mbr_val_${stamp}`;
    const attId = `att_val_${stamp}`;
    const storageKey = `org_val_${stamp}/issue/att_val_${stamp}/data.txt`;
    const testBytes = new TextEncoder().encode('valid data for test');

    const store = new Map<string, Uint8Array>([[storageKey, testBytes]]);
    const driver = createMockDriver(store);

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await sql`insert into organization (id, name, slug) values (${orgId}, 'Val Org', ${orgId})`;
      await sql`insert into "user" (id, name, email, handle) values (${userId}, 'Val User', ${`${userId}@orbit.test`}, ${userId})`;
      await sql`insert into member (id, organization_id, user_id, role) values (${memberId}, ${orgId}, ${userId}, 'owner')`;
      await sql`
        insert into attachment (id, organization_id, parent_type, parent_id, file_name, content_type, size, storage_key, status, uploaded_by_id)
        values (${attId}, ${orgId}, 'issue', 'dummy', 'data.txt', 'text/plain', ${testBytes.byteLength}, ${storageKey}, 'ready', ${userId})
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    try {
      const result = await validateRestore({
        databaseUrl,
        storageDriver: driver,
        migrationsFolder: MIGRATIONS,
        skipRedisCheck: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.migrationStatus.isBehind).toBe(false);
      expect(result.integrity.referentialIntegrityPassed).toBe(true);
      expect(result.storage.missingObjects).toBe(0);
      expect(result.storage.checkedObjects).toBeGreaterThanOrEqual(1);
      expect(result.auth.bootstrapWindowClosed).toBe(true);
    } finally {
      const cleanupSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await cleanupSql`delete from attachment where id = ${attId}`;
        await cleanupSql`delete from member where id = ${memberId}`;
        await cleanupSql`delete from "user" where id = ${userId}`;
        await cleanupSql`delete from organization where id = ${orgId}`;
      } finally {
        await cleanupSql.end({ timeout: 5 });
      }
    }
  });

  it('fails validation when referenced attachment object is missing in storage driver', async () => {
    if (!reachable) return;
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orgId = `org_miss_${stamp}`;
    const userId = `usr_miss_${stamp}`;
    const memberId = `mbr_miss_${stamp}`;
    const attId = `att_miss_${stamp}`;
    const storageKey = `org_miss_${stamp}/issue/att_miss_${stamp}/missing.txt`;

    const store = new Map<string, Uint8Array>();
    const driver = createMockDriver(store);

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await sql`insert into organization (id, name, slug) values (${orgId}, 'Miss Org', ${orgId})`;
      await sql`insert into "user" (id, name, email, handle) values (${userId}, 'Miss User', ${`${userId}@orbit.test`}, ${userId})`;
      await sql`insert into member (id, organization_id, user_id, role) values (${memberId}, ${orgId}, ${userId}, 'owner')`;
      await sql`
        insert into attachment (id, organization_id, parent_type, parent_id, file_name, content_type, size, storage_key, status, uploaded_by_id)
        values (${attId}, ${orgId}, 'issue', 'dummy', 'missing.txt', 'text/plain', 50, ${storageKey}, 'ready', ${userId})
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    try {
      const result = await validateRestore({
        databaseUrl,
        storageDriver: driver,
        migrationsFolder: MIGRATIONS,
        skipRedisCheck: true,
      });

      expect(result.valid).toBe(false);
      expect(result.storage.missingObjects).toBeGreaterThanOrEqual(1);
      expect(result.errors.some((e) => e.includes('was not found in storage'))).toBe(true);
    } finally {
      const cleanupSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await cleanupSql`delete from attachment where id = ${attId}`;
        await cleanupSql`delete from member where id = ${memberId}`;
        await cleanupSql`delete from "user" where id = ${userId}`;
        await cleanupSql`delete from organization where id = ${orgId}`;
      } finally {
        await cleanupSql.end({ timeout: 5 });
      }
    }
  });

  it('fails validation when an organization has no members', async () => {
    expect(reachable).toBe(true);
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orgId = `org_unowned_${stamp}`;

    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
    try {
      await sql`insert into organization (id, name, slug) values (${orgId}, 'Unowned Org', ${orgId})`;
    } finally {
      await sql.end({ timeout: 5 });
    }

    try {
      const result = await validateRestore({
        databaseUrl,
        migrationsFolder: MIGRATIONS,
        skipRedisCheck: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('without any member'))).toBe(true);
    } finally {
      const cleanupSql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
      try {
        await cleanupSql`delete from organization where id = ${orgId}`;
      } finally {
        await cleanupSql.end({ timeout: 5 });
      }
    }
  });

  it('fails validation when configured redis endpoint is unreachable', async () => {
    expect(reachable).toBe(true);

    const result = await validateRestore({
      databaseUrl,
      migrationsFolder: MIGRATIONS,
      redisUrl: 'redis://127.0.0.1:59999',
      skipRedisCheck: false,
    });

    expect(result.valid).toBe(false);
    expect(result.redis.tested).toBe(false);
    expect(result.errors.some((e) => e.includes('Failed to ping configured Redis endpoint'))).toBe(
      true,
    );
  });
});
