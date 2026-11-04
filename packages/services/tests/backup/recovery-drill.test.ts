import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import {
  runRecoveryDrill,
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
