import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { computeRestoreTargetIdentity } from '@orbit/shared';
import postgres from 'postgres';
import {
  computeDrillRedisTargetIdentity,
  runRecoveryDrill,
  seedDrillRepresentativeData,
  verifyDrillRepresentativeData,
} from '../../src/backup/recovery-drill.ts';
import type { RecoveryDrillRepresentativeData } from '../../src/backup/types.ts';
import type { StorageDriver, StoredObject, UploadTarget } from '../../src/storage/types.ts';

function createMockDriver(files: Map<string, Uint8Array>): StorageDriver {
  return {
    name: 's3',
    createUploadTarget(
      key: string,
      _contentType: string,
      contentLength: number,
    ): Promise<UploadTarget> {
      return Promise.resolve({
        key,
        url: `https://example.com/${key}`,
        method: 'PUT',
        headers: {},
        maxBytes: contentLength,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    },
    put(key: string, body: Uint8Array): Promise<void> {
      files.set(key, body);
      return Promise.resolve();
    },
    getUrl(key: string): Promise<string> {
      return Promise.resolve(`https://example.com/${key}`);
    },
    get(key: string): Promise<Uint8Array | null> {
      return Promise.resolve(files.get(key) ?? null);
    },
    delete(key: string): Promise<void> {
      files.delete(key);
      return Promise.resolve();
    },
    summarizePrefix(): Promise<{
      objects: number;
      bytes: number;
      versions: number;
      versionBytes: number;
    }> {
      return Promise.resolve({ objects: files.size, bytes: 0, versions: 0, versionBytes: 0 });
    },
    deletePrefix(): Promise<void> {
      return Promise.resolve();
    },
    stat(key: string): Promise<StoredObject | null> {
      const data = files.get(key);
      if (data === undefined) return Promise.resolve(null);
      return Promise.resolve({
        key,
        size: data.length,
        contentType: 'application/octet-stream',
        updatedAt: new Date(),
      });
    },
  };
}

describe('recovery drill verification', () => {
  for (const table of [
    'account',
    'session',
    'team_member',
    'expired session',
    'revived session',
    'changed account',
    'unexpected team member',
  ] as const) {
    it(`rejects restored data with invalid ${table} records`, async () => {
      const databaseUrl = process.env['DATABASE_URL'];
      if (databaseUrl === undefined || !new URL(databaseUrl).pathname.includes('test')) {
        throw new Error('An isolated test database is required.');
      }
      const sql = postgres(databaseUrl, { max: 1, prepare: false });
      const rollback = new Error('Roll back representative fixture');
      try {
        await sql.begin(async (tx) => {
          const driver = createMockDriver(new Map());
          const connection = tx as unknown as postgres.Sql;
          const data = await seedDrillRepresentativeData(connection, driver);
          const before = await verifyDrillRepresentativeData(connection, driver, data);
          expect(before).toEqual({ valid: true, errors: [] });
          if (table === 'team_member') {
            await tx`delete from public.team_member where team_id = ${data.teamId}`;
          } else if (table === 'expired session') {
            await tx`update public.session set expires_at = ${new Date(0)} where user_id = ${data.memberUserId}`;
          } else if (table === 'revived session') {
            await tx`update public.session set expires_at = ${new Date(Date.now() + 86400000)} where user_id = ${data.revokedUserId}`;
          } else if (table === 'changed account') {
            await tx`update public.account set account_id = 'different-account' where user_id = ${data.memberUserId}`;
          } else if (table === 'unexpected team member') {
            await tx`insert into public.team_member (id, team_id, user_id) values ('unexpected-membership', ${data.teamId}, ${data.revokedUserId})`;
          } else {
            await tx`delete from ${tx(table)} where user_id in (${data.adminUserId}, ${data.memberUserId}, ${data.revokedUserId})`;
          }
          const result = await verifyDrillRepresentativeData(connection, driver, data);
          expect(result.valid).toBe(false);
          let entity = 'team member';
          if (table.includes('session')) entity = 'session';
          if (table.includes('account')) entity = 'account';
          expect(result.errors.some((error) => error.toLowerCase().includes(entity))).toBe(true);
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      } finally {
        await sql.end();
      }
    });
  }

  it('refuses an unconfirmed Redis endpoint before opening any destructive connection', async () => {
    const databaseUrl = 'postgres://127.0.0.1:1/isolated_drill';
    await expect(
      runRecoveryDrill({
        databaseUrl,
        confirmDestructiveTarget: computeRestoreTargetIdentity(
          databaseUrl,
          process.env['S3_BUCKET'],
        ).identity,
        redisUrl: 'redis://unconfirmed.example.test:6379/4',
      }),
    ).rejects.toThrow('confirmRedisTarget');
  });

  it('refuses a changed Redis target even when the database confirmation matches', async () => {
    const databaseUrl = 'postgres://127.0.0.1:1/isolated_drill';
    await expect(
      runRecoveryDrill({
        databaseUrl,
        confirmDestructiveTarget: computeRestoreTargetIdentity(
          databaseUrl,
          process.env['S3_BUCKET'],
        ).identity,
        redisUrl: 'rediss://different.example.test:6380/4',
        confirmRedisTarget: 'rediss://confirmed.example.test:6380/db/4',
      }),
    ).rejects.toThrow('confirmRedisTarget');
  });

  it('normalizes the Redis confirmation without exposing credentials', () => {
    expect(computeDrillRedisTargetIdentity('redis://user:secret@LOCALHOST/004')).toBe(
      'redis://localhost:6379/db/4',
    );
    expect(computeDrillRedisTargetIdentity('rediss://localhost:6380')).toBe(
      'rediss://localhost:6380/db/0',
    );
    expect(() => computeDrillRedisTargetIdentity('redis://localhost/0?db=4')).toThrow();
    expect(() => computeDrillRedisTargetIdentity('https://localhost/0')).toThrow();
  });

  it('passes verification when all entities, grants, and attachments match', async () => {
    const attachmentContent = Buffer.from('hello attachment test', 'utf8');
    const attachmentHash = createHash('sha256').update(attachmentContent).digest('hex');
    const storageFiles = new Map<string, Uint8Array>();
    storageFiles.set('org_1/issue/iss_1/file.txt', attachmentContent);

    const driver = createMockDriver(storageFiles);

    const mockData: RecoveryDrillRepresentativeData = {
      organizationId: 'org_1',
      adminUserId: 'usr_admin',
      memberUserId: 'usr_member',
      revokedUserId: 'usr_revoked',
      teamId: 'team_1',
      projectId: 'proj_1',
      issueId: 'iss_1',
      commentId: 'com_1',
      docId: 'doc_1',
      activeGrantId: 'grant_active',
      revokedGrantId: 'grant_revoked',
      attachments: [
        {
          id: 'att_1',
          storageKey: 'org_1/issue/iss_1/file.txt',
          fileName: 'file.txt',
          contentType: 'text/plain',
          bytes: attachmentContent.length,
          sha256: attachmentHash,
          content: attachmentContent,
        },
      ],
    };

    const mockSql = ((strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.reduce(
        (acc, str, i) => acc + str + (args[i] === undefined ? '' : String(args[i])),
        '',
      );
      if (query.includes('from public.account')) {
        return Promise.resolve([{ account_id: args[0], provider_id: 'credential' }]);
      }
      if (query.includes('from public.session')) {
        const token = String(args[0]);
        let user = 'usr_member';
        if (token.includes('admin')) user = 'usr_admin';
        if (token.includes('revoked')) user = 'usr_revoked';
        return Promise.resolve([
          {
            user_id: user,
            expires_at: new Date(Date.now() + (token.includes('revoked') ? -86400000 : 86400000)),
          },
        ]);
      }
      if (query.includes('from public.team_member')) {
        return Promise.resolve(args[0] === 'usr_revoked' ? [] : [{ team_id: 'team_1' }]);
      }
      if (query.includes('from public.organization')) {
        return Promise.resolve([{ id: 'org_1' }]);
      }
      if (query.includes('from public.issue')) {
        return Promise.resolve([{ id: 'iss_1', title: 'Issue 1' }]);
      }
      if (query.includes('from public.comment')) {
        return Promise.resolve([{ id: 'com_1' }]);
      }
      if (query.includes('from public.doc')) {
        return Promise.resolve([{ id: 'doc_1' }]);
      }
      if (query.includes('grant_active')) {
        return Promise.resolve([{ id: 'grant_active', revoked_at: null }]);
      }
      if (query.includes('grant_revoked')) {
        return Promise.resolve([{ id: 'grant_revoked', revoked_at: new Date() }]);
      }
      if (query.includes('usr_admin')) {
        return Promise.resolve([{ role: 'admin' }]);
      }
      if (query.includes('usr_member')) {
        return Promise.resolve([{ role: 'member' }]);
      }
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;

    const result = await verifyDrillRepresentativeData(mockSql, driver, mockData);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails verification when attachment object is missing in storage driver', async () => {
    const attachmentContent = Buffer.from('hello attachment test', 'utf8');
    const attachmentHash = createHash('sha256').update(attachmentContent).digest('hex');
    const storageFiles = new Map<string, Uint8Array>();
    const driver = createMockDriver(storageFiles);

    const mockData: RecoveryDrillRepresentativeData = {
      organizationId: 'org_1',
      adminUserId: 'usr_admin',
      memberUserId: 'usr_member',
      revokedUserId: 'usr_revoked',
      teamId: 'team_1',
      projectId: 'proj_1',
      issueId: 'iss_1',
      commentId: 'com_1',
      docId: 'doc_1',
      activeGrantId: 'grant_active',
      revokedGrantId: 'grant_revoked',
      attachments: [
        {
          id: 'att_1',
          storageKey: 'org_1/issue/iss_1/missing.txt',
          fileName: 'missing.txt',
          contentType: 'text/plain',
          bytes: attachmentContent.length,
          sha256: attachmentHash,
          content: attachmentContent,
        },
      ],
    };

    const mockSql = ((strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      if (query.includes('from public.organization')) return Promise.resolve([{ id: 'org_1' }]);
      if (query.includes('from public.issue'))
        return Promise.resolve([{ id: 'iss_1', title: 'Issue' }]);
      if (query.includes('from public.comment')) return Promise.resolve([{ id: 'com_1' }]);
      if (query.includes('from public.doc')) return Promise.resolve([{ id: 'doc_1' }]);
      if (query.includes('grant_active'))
        return Promise.resolve([{ id: 'grant_active', revoked_at: null }]);
      if (query.includes('grant_revoked'))
        return Promise.resolve([{ id: 'grant_revoked', revoked_at: new Date() }]);
      if (query.includes('usr_admin')) return Promise.resolve([{ role: 'admin' }]);
      if (query.includes('usr_member')) return Promise.resolve([{ role: 'member' }]);
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;

    const result = await verifyDrillRepresentativeData(mockSql, driver, mockData);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing in storage driver'))).toBe(true);
  });

  it('fails verification when attachment binary content differs byte-for-byte', async () => {
    const expectedContent = Buffer.from('expected-content-abc', 'utf8');
    const expectedHash = createHash('sha256').update(expectedContent).digest('hex');

    const corruptedContent = Buffer.from('corrupted-content-xyz', 'utf8');
    const storageFiles = new Map<string, Uint8Array>();
    storageFiles.set('org_1/corrupt.bin', corruptedContent);
    const driver = createMockDriver(storageFiles);

    const mockData: RecoveryDrillRepresentativeData = {
      organizationId: 'org_1',
      adminUserId: 'usr_admin',
      memberUserId: 'usr_member',
      revokedUserId: 'usr_revoked',
      teamId: 'team_1',
      projectId: 'proj_1',
      issueId: 'iss_1',
      commentId: 'com_1',
      docId: 'doc_1',
      activeGrantId: 'grant_active',
      revokedGrantId: 'grant_revoked',
      attachments: [
        {
          id: 'att_1',
          storageKey: 'org_1/corrupt.bin',
          fileName: 'corrupt.bin',
          contentType: 'application/octet-stream',
          bytes: expectedContent.length,
          sha256: expectedHash,
          content: expectedContent,
        },
      ],
    };

    const mockSql = ((strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      if (query.includes('from public.organization')) return Promise.resolve([{ id: 'org_1' }]);
      if (query.includes('from public.issue'))
        return Promise.resolve([{ id: 'iss_1', title: 'Issue' }]);
      if (query.includes('from public.comment')) return Promise.resolve([{ id: 'com_1' }]);
      if (query.includes('from public.doc')) return Promise.resolve([{ id: 'doc_1' }]);
      if (query.includes('grant_active'))
        return Promise.resolve([{ id: 'grant_active', revoked_at: null }]);
      if (query.includes('grant_revoked'))
        return Promise.resolve([{ id: 'grant_revoked', revoked_at: new Date() }]);
      if (query.includes('usr_admin')) return Promise.resolve([{ role: 'admin' }]);
      if (query.includes('usr_member')) return Promise.resolve([{ role: 'member' }]);
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;

    const result = await verifyDrillRepresentativeData(mockSql, driver, mockData);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('differs byte-for-byte') || e.includes('mismatch')),
    ).toBe(true);
  });

  it('rejects recovery drill execution when database url is empty', async () => {
    await expect(
      runRecoveryDrill({
        databaseUrl: '',
      }),
    ).rejects.toThrow('Target database connection URL is required for recovery drill.');
  });

  it('rejects recovery drill execution when destructive confirmation does not match target', async () => {
    await expect(
      runRecoveryDrill({
        databaseUrl: 'postgres://localhost:5432/testdb',
        confirmDestructiveTarget: 'mismatched-target',
      }),
    ).rejects.toThrow('Recovery drill refused: confirmDestructiveTarget');
  });
});
