import { beforeAll, describe, expect, it } from 'bun:test';
import { createServer } from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '@orbit/db/migration-release';
import postgres from 'postgres';
import { resolveTestDatabaseUrl } from '../../../../scripts/test-env.ts';
import { pingRedis, redactRedisEndpoint, validateRestore } from '../../src/backup/validate.ts';
import type { StorageDriver, StoredObject, UploadTarget } from '../../src/storage/types.ts';

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDGo0mT1wLJ1oeZ
pSiSKbQDsslXRTshZ9Um3WnyfjgrDoHEtvXzTk7kdeYsrjXi8/zgFkX7kTVZ96np
J/8knyU76oUxNyUrbvOKM5CjYuQIaZ6yivbAXz9kostqEcDeohFlSM8UsxUy0IBr
ox3c1QzQVCrhhkwNrE3qqCYekyZj3Q9hHOIkexA3IaW1WiXaOjvQIN6mKImY6msc
/dU6BdokTl2NkGyb51ft4L8A25IXHhp5mwc/6sEMsOKfzX9NSmgWphAMFpApZg5z
Jfbbj4f3mjx1ZnY/h/CJSWVVTig379u4LzG+YxwoEmjCe0iag9DTkYIXf5ULQFju
sKRNTEQ9AgMBAAECggEADnOSxs69xTF2bBc3/GpMTniTbWX8B1Imj81MB/hm3bsQ
dd9ZxXnNA5IQTO/fu8NEgokcTlEiMIl0MyJVzbRGYTWOuyXn7mEEFunpe/mV3YbR
pOu3SAel9QxjADSKc6gW2+eQKVFeGXRR44LaiVZ2uDFnbUD4B4ahpJDXNSI/iMRL
odKwySIJrJja/HfzF2SjsRg58K8Kc6aGDGEtQfOYGL+mcoZ1KOzdlVdrXq2+AkDm
MXe2z+nZNILxvq2P4r1PvQQmT/bIrm4ABjQ37ILXzgwrq2INX10st8Kd5RBuIv4X
WgwsgKxpS8/+ulkBnIirZFF3166nvRE4xvDYbRSQAQKBgQDrym4yTmGllscSRhN7
Kp8wImW7VJ3pS/97iI4FcEWVFFICTDqZpm6KY0eiE3JMXZWDcnPPSxMlWtpTHpOb
m9fqv8FSAwFfw2uqcf4+ko3F2jXxF4WjxYFtmYMPTppFofAbwjVml0cD5qSOvtTZ
Hq/9lFLRc2JQZ5OvR/L500JKYQKBgQDXqav4OL1YqM8AP96+esmy4zZADFWgJ+z+
Bym12Ssc4golBIIVI8CdUMW+9l8kOLuuGHJfEEvzaCppnnitjmBQ+QwUlGgNwYnv
zj4n7IJithdQ+X2PZNd5ONSi7eE+UlX1pQjnq8kW9HlQAmA1oRL4WS9u3HakOYdo
yJYu4iWfXQKBgQCeBv7R4mxZQXNMEQEvdAJajUMnSO/IkvG4Rm4AwR0xa/wGpDZG
EiBVyXIR8vyQp8vz2/o3/PXo/DoEqSJ+kPUl1LxpDbCXEO8QvfOK1kgESVoLqhsc
BtvWq6MF2EVW09CLmh6WEl87AxJYxRb8KTAEQKs8yxsiDjkRqaPzwZ3VIQKBgQCS
ZZNfhOTD8pPST4kdNK0GykZhY/4cIf420xX1Y95oVOkeB9lmEEcIg3Q5FXWwWPLO
U7oP3jgwm11vJSw2ZJftX6JbtgKMk/zW1OJMp7g62fEp/rLFTGcY2wM9Ns3YSHwh
rE5HNc3jz0EqlvJIdXczLxeL4gyHnqXU85U/bjSr4QKBgDYUAgo+prpv+T2V0O4/
n2xUbsDFC9CROQC4yrTzheay8XZhI10454qj8/sXIFR5q57vgOgsrK+/B0tg7XuA
a2hGNnEsESmMQuUkq+wtFWsDJw0GUYJNjoFQigAMsblKtif8medJWL9xYFyJzLmb
4/ZSNNzVGBxbWbKkRn8QhvtS
-----END PRIVATE KEY-----`;

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIC1DCCAbygAwIBAgIUZdd54t5uz8C/osAVRXZOijWKxJAwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDkyMjEzMzc1N1oXDTM2MDkx
OTEzMzc1N1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAxqNJk9cCydaHmaUokim0A7LJV0U7IWfVJt1p8n44Kw6B
xLb1805O5HXmLK414vP84BZF+5E1Wfep6Sf/JJ8lO+qFMTclK27zijOQo2LkCGme
sor2wF8/ZKLLahHA3qIRZUjPFLMVMtCAa6Md3NUM0FQq4YZMDaxN6qgmHpMmY90P
YRziJHsQNyGltVol2jo70CDepiiJmOprHP3VOgXaJE5djZBsm+dX7eC/ANuSFx4a
eZsHP+rBDLDin81/TUpoFqYQDBaQKWYOcyX224+H95o8dWZ2P4fwiUllVU4oN+/b
uC8xvmMcKBJowntImoPQ05GCF3+VC0BY7rCkTUxEPQIDAQABox4wHDAaBgNVHREE
EzARgglsb2NhbGhvc3SHBH8AAAEwDQYJKoZIhvcNAQELBQADggEBAFFXz1/vdx0L
GcTbOQLICsz1h8Ux5PYDGkfcisrlbWlMP+94fbfveq2OMtx6x/B3K+lxQ4A8YDWF
6b9jNruCO2cA8RWZcPlH/5Lxn4rhUtEGQDBKFxWtxEvLewKSVm6NrmxvTpbOgoyH
ORF1X/O1TA/Iz5BV5T8FsIP1hLJjfOgl26ICfg/2mkLZBvzObrzJmOifQ5iNii8+
PJ77lu1pWXzi3jKdzAoKIz5mryiktUm+IQIlYTSW8LJ3UFt1thNxp3YGT7Zfx9tP
ZQOxR/indqFfa4m84GNMbNo/Q00hVpo9ry9y+1lR5ZMTtfTi9mVwoh9naphqsscd
V9UswwUgzSk=
-----END CERTIFICATE-----`;

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

  it('redacts credentials from redis endpoints in error messages', async () => {
    expect(redactRedisEndpoint('redis://default:mysecretpassword@redis.internal.net:6379')).toBe(
      'redis://***:***@redis.internal.net:6379',
    );
    expect(redactRedisEndpoint('rediss://:topsecret@secure.redis.cloud:6380')).toBe(
      'rediss://:***@secure.redis.cloud:6380',
    );

    const result = await validateRestore({
      databaseUrl,
      migrationsFolder: MIGRATIONS,
      redisUrl: 'redis://redis_user:super_secret_pwd@127.0.0.1:59999',
      skipRedisCheck: false,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('super_secret_pwd'))).toBe(false);
    expect(result.errors.some((e) => e.includes('redis://***:***@127.0.0.1:59999'))).toBe(true);
  });

  it('authenticates with protected Redis using credentials', async () => {
    let authSeen = false;
    const server = createServer((socket) => {
      socket.on('data', (chunk) => {
        const text = chunk.toString().toUpperCase();
        if (text.includes('AUTH')) {
          authSeen = true;
          socket.write('+OK\r\n');
        }
        if (text.includes('PING')) {
          socket.write('+PONG\r\n');
        }
        if (text.includes('QUIT')) {
          socket.end('+OK\r\n');
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    try {
      const pingResult = await pingRedis(`redis://:auth_secret@127.0.0.1:${port}`);
      expect(pingResult).toBe(true);
      expect(authSeen).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('connects to rediss TLS endpoint successfully', async () => {
    const server = tls.createServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, (socket) => {
      socket.on('data', (chunk) => {
        const text = chunk.toString().toUpperCase();
        if (text.includes('PING')) {
          socket.write('+PONG\r\n');
        }
        if (text.includes('QUIT')) {
          socket.end('+OK\r\n');
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    try {
      const pingResult = await pingRedis(`rediss://127.0.0.1:${port}`);
      expect(pingResult).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
