import { beforeEach, describe, expect, it } from 'bun:test';
import { and, count, db, eq, schema, sql } from '@orbit/db';
import {
  type StorageDriver,
  type StoragePrefixSummary,
  UPLOAD_COMPLETION_GRACE_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from '@orbit/services/storage';
import { internal } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import postgres from 'postgres';
import { registerUpload } from '../../src/content/attachment-service.ts';
import { createDoc } from '../../src/content/doc-service.ts';
import * as core from '../../src/index.ts';
import { newId } from '../../src/internal.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';
import { createProject } from '../../src/work/project-service.ts';

interface DeletionSummary {
  readonly organizationName: string;
  readonly members: number;
  readonly teams: number;
  readonly projects: number;
  readonly issues: number;
  readonly documents: number;
  readonly files: number;
  readonly fileBytes: number;
  readonly fileVersions: number;
  readonly fileVersionBytes: number;
  readonly integrations: number;
  readonly webhooks: number;
  readonly availableAt: string | null;
  readonly deletionRequestedAt: string | null;
}

interface DeletionResult {
  readonly deletedOrganizationId: string;
  readonly deletedOrganizationName: string;
  readonly nextOrganizationId: string | null;
}

const expectedCore = core as typeof core & {
  readonly getOrganizationDeletionSummary: (
    principal: Principal,
    driver: StorageDriver,
    now?: Date,
  ) => Promise<DeletionSummary>;
  readonly deleteOrganization: (
    principal: Principal,
    input: unknown,
    driver: StorageDriver,
    now?: Date,
  ) => Promise<DeletionResult>;
};
const { deleteOrganization, getOrganizationDeletionSummary } = expectedCore;
const deletionDrainMilliseconds = (UPLOAD_URL_TTL_SECONDS + UPLOAD_COMPLETION_GRACE_SECONDS) * 1000;

interface FakeStorage {
  readonly driver: StorageDriver;
  readonly summarized: string[];
  readonly deleted: string[];
}

function fakeStorage(
  summary: StoragePrefixSummary = { objects: 0, bytes: 0, versions: 0, versionBytes: 0 },
  deleteError: Error | null = null,
): FakeStorage {
  const summarized: string[] = [];
  const deleted: string[] = [];
  const driver = {
    name: 's3',
    createUploadTarget: () => Promise.reject(new Error('unused')),
    put: () => Promise.reject(new Error('unused')),
    getUrl: () => Promise.reject(new Error('unused')),
    delete: () => Promise.reject(new Error('unused')),
    stat: () => Promise.reject(new Error('unused')),
    summarizePrefix: (prefix: string) => {
      summarized.push(prefix);
      return Promise.resolve(summary);
    },
    deletePrefix: (prefix: string) => {
      deleted.push(prefix);
      return deleteError === null ? Promise.resolve() : Promise.reject(deleteError);
    },
  } as unknown as StorageDriver;
  return { driver, summarized, deleted };
}

let nova: Workspace;
let orion: Workspace;

beforeEach(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');
});

async function seedDeletionInventory(): Promise<void> {
  await addMember(nova, 'member', { name: 'Mira Member' });
  await createProject(nova.admin, { name: 'Roadmap', teamIds: [nova.teamId] });
  await createIssue(nova.admin, { teamId: nova.teamId, title: 'First issue' });
  await createIssue(nova.admin, { teamId: nova.teamId, title: 'Second issue' });
  await createDoc(nova.admin, { title: 'Workspace handbook' });
  await db.insert(schema.integration).values({
    id: newId(),
    organizationId: nova.organizationId,
    provider: 'slack',
    externalId: 'team_nova',
    connectedById: nova.adminUser.id,
  });
  await db.insert(schema.webhook).values({
    id: newId(),
    organizationId: nova.organizationId,
    url: 'https://hooks.example/nova',
    secret: 'secret',
    createdById: nova.adminUser.id,
  });
  await createIssue(orion.admin, { teamId: orion.teamId, title: 'Neighbor issue' });
  await createIssue(orion.admin, { teamId: orion.teamId, title: 'Neighbor issue two' });
  await createIssue(orion.admin, { teamId: orion.teamId, title: 'Neighbor issue three' });
}

async function organizationCount(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  return row?.total ?? 0;
}

async function makeDeletionReady(organizationId: string, now: Date): Promise<void> {
  await db
    .update(schema.organization)
    .set({ deletionRequestedAt: new Date(now.getTime() - deletionDrainMilliseconds) })
    .where(eq(schema.organization.id, organizationId));
}

function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) throw new Error('DATABASE_URL is required.');
  return url;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('getOrganizationDeletionSummary', () => {
  it('reports categorized tenant counts and the actual storage prefix inventory', async () => {
    await seedDeletionInventory();
    const storage = fakeStorage({ objects: 3, bytes: 3_072, versions: 5, versionBytes: 4_096 });

    const summary = await getOrganizationDeletionSummary(nova.admin, storage.driver);

    expect(summary).toEqual({
      organizationName: 'Nova',
      members: 2,
      teams: 1,
      projects: 1,
      issues: 2,
      documents: 1,
      files: 3,
      fileBytes: 3_072,
      fileVersions: 5,
      fileVersionBytes: 4_096,
      integrations: 1,
      webhooks: 1,
      availableAt: null,
      deletionRequestedAt: null,
    });
    expect(storage.summarized).toEqual([`${nova.organizationId}/`]);
  });

  it('refuses non-administrators before reading storage', async () => {
    const member = await addMember(nova, 'member');
    const storage = fakeStorage({ objects: 9, bytes: 99, versions: 9, versionBytes: 99 });

    await expect(
      getOrganizationDeletionSummary(member.principal, storage.driver),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(storage.summarized).toEqual([]);
  });

  it('reports the latest upload expiration plus its completion grace', async () => {
    const earlier = new Date('2026-08-08T12:10:00.000Z');
    const later = new Date('2026-08-08T12:12:00.000Z');
    await db.insert(schema.attachment).values([
      {
        id: newId(),
        organizationId: nova.organizationId,
        parentType: 'issue',
        parentId: 'issue_1',
        fileName: 'one.txt',
        contentType: 'text/plain',
        size: 1,
        storageKey: `${nova.organizationId}/one.txt`,
        status: 'pending',
        uploadedById: nova.adminUser.id,
        uploadExpiresAt: earlier,
      },
      {
        id: newId(),
        organizationId: nova.organizationId,
        parentType: 'issue',
        parentId: 'issue_2',
        fileName: 'two.txt',
        contentType: 'text/plain',
        size: 1,
        storageKey: `${nova.organizationId}/two.txt`,
        status: 'pending',
        uploadedById: nova.adminUser.id,
        uploadExpiresAt: later,
      },
    ]);

    const summary = await getOrganizationDeletionSummary(
      nova.admin,
      fakeStorage().driver,
      new Date('2026-08-08T12:00:00.000Z'),
    );

    expect(summary.availableAt).toBe(
      new Date(later.getTime() + UPLOAD_COMPLETION_GRACE_SECONDS * 1000).toISOString(),
    );
  });

  it('reports the deletion request drain when it ends after tracked uploads', async () => {
    const requestedAt = new Date('2026-08-08T12:00:00.000Z');
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: requestedAt })
      .where(eq(schema.organization.id, nova.organizationId));

    const summary = await getOrganizationDeletionSummary(
      nova.admin,
      fakeStorage().driver,
      requestedAt,
    );

    expect(summary.availableAt).toBe(
      new Date(requestedAt.getTime() + deletionDrainMilliseconds).toISOString(),
    );
  });
});

describe('deleteOrganization', () => {
  it('requires the current case-sensitive workspace name', async () => {
    const storage = fakeStorage();

    await expect(
      deleteOrganization(nova.admin, { confirmation: 'nova' }, storage.driver),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await organizationCount(nova.organizationId)).toBe(1);
    expect(storage.deleted).toEqual([]);
  });

  it('refuses a confirmation captured before another administrator renamed the workspace', async () => {
    await db
      .update(schema.organization)
      .set({ name: 'Nova Renamed' })
      .where(eq(schema.organization.id, nova.organizationId));
    const storage = fakeStorage();

    await expect(
      deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await organizationCount(nova.organizationId)).toBe(1);
    expect(storage.deleted).toEqual([]);
  });

  it('refuses a stale administrator principal after the member was demoted', async () => {
    await db
      .update(schema.member)
      .set({ role: 'member' })
      .where(
        and(
          eq(schema.member.organizationId, nova.organizationId),
          eq(schema.member.userId, nova.admin.userId),
        ),
      );
    const storage = fakeStorage();

    await expect(
      deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await organizationCount(nova.organizationId)).toBe(1);
    expect(storage.deleted).toEqual([]);
  });

  it('blocks while a presigned target can still recreate the prefix', async () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    await makeDeletionReady(nova.organizationId, now);
    const uploadExpiresAt = new Date('2026-08-08T12:01:00.000Z');
    const availableAt = new Date(
      uploadExpiresAt.getTime() + UPLOAD_COMPLETION_GRACE_SECONDS * 1000,
    );
    await db.insert(schema.attachment).values({
      id: newId(),
      organizationId: nova.organizationId,
      parentType: 'issue',
      parentId: 'issue_1',
      fileName: 'pending.txt',
      contentType: 'text/plain',
      size: 1,
      storageKey: `${nova.organizationId}/pending.txt`,
      status: 'pending',
      uploadedById: nova.adminUser.id,
      uploadExpiresAt,
    });
    const storage = fakeStorage();

    await expect(
      deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver, now),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { availableAt: availableAt.toISOString() },
    });
    expect(storage.deleted).toEqual([]);
  });

  it('drains a presigned target whose attachment transaction failed', async () => {
    const requestedAt = new Date('2026-08-08T12:00:00.000Z');
    const availableAt = new Date(requestedAt.getTime() + deletionDrainMilliseconds);
    const { issue } = await createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Failed upload registration',
    });
    let targetCreated = false;
    const uploadDriver = {
      ...fakeStorage().driver,
      createUploadTarget: (key: string, contentType: string, contentLength: number) => {
        targetCreated = true;
        return Promise.resolve({
          key,
          url: `https://storage.example/${key}`,
          method: 'PUT' as const,
          headers: { 'content-type': contentType },
          maxBytes: contentLength,
          expiresAt: new Date(requestedAt.getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
        });
      },
    } as StorageDriver;
    await db.execute(sql`drop trigger if exists reject_attachment_registration on attachment`);
    await db.execute(sql`
      create or replace function reject_attachment_registration() returns trigger as $$
      begin
        raise exception 'attachment registration failed';
      end;
      $$ language plpgsql
    `);
    await db.execute(sql`
      create trigger reject_attachment_registration
      before insert on attachment
      for each row execute function reject_attachment_registration()
    `);
    try {
      await expect(
        registerUpload(
          nova.admin,
          {
            fileName: 'untracked.txt',
            contentType: 'text/plain',
            size: 4,
            parentType: 'issue',
            parentId: issue.id,
          },
          uploadDriver,
        ),
      ).rejects.toBeDefined();
    } finally {
      await db.execute(sql`drop trigger if exists reject_attachment_registration on attachment`);
      await db.execute(sql`drop function if exists reject_attachment_registration()`);
    }
    const [untracked] = await db
      .select({ total: count() })
      .from(schema.attachment)
      .where(eq(schema.attachment.organizationId, nova.organizationId));
    expect(targetCreated).toBe(true);
    expect(untracked?.total).toBe(0);
    const storage = fakeStorage();

    await expect(
      deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver, requestedAt),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { availableAt: availableAt.toISOString() },
    });

    const [pending] = await db
      .select({ deletionRequestedAt: schema.organization.deletionRequestedAt })
      .from(schema.organization)
      .where(eq(schema.organization.id, nova.organizationId));
    expect(pending?.deletionRequestedAt).toEqual(requestedAt);
    expect(storage.deleted).toEqual([]);

    const result = await deleteOrganization(
      nova.admin,
      { confirmation: 'Nova' },
      storage.driver,
      availableAt,
    );

    expect(result.deletedOrganizationId).toBe(nova.organizationId);
    expect(storage.deleted).toEqual([`${nova.organizationId}/`]);
  });

  it('deletes the exact prefix and tenant rows while preserving shared people and sessions', async () => {
    await seedDeletionInventory();
    await db.insert(schema.member).values({
      id: newId(),
      organizationId: orion.organizationId,
      userId: nova.adminUser.id,
      role: 'member',
    });
    const sessionId = newId();
    await db.insert(schema.session).values({
      id: sessionId,
      token: newId(),
      userId: nova.adminUser.id,
      activeOrganizationId: nova.organizationId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const storage = fakeStorage({
      objects: 4,
      bytes: 4_096,
      versions: 4,
      versionBytes: 4_096,
    });
    const now = new Date('2026-08-08T14:00:00.000Z');
    await makeDeletionReady(nova.organizationId, now);

    const result = await deleteOrganization(
      nova.admin,
      { confirmation: 'Nova' },
      storage.driver,
      now,
    );

    expect(result).toEqual({
      deletedOrganizationId: nova.organizationId,
      deletedOrganizationName: 'Nova',
      nextOrganizationId: orion.organizationId,
    });
    expect(storage.deleted).toEqual([`${nova.organizationId}/`]);
    expect(await organizationCount(nova.organizationId)).toBe(0);
    expect(await organizationCount(orion.organizationId)).toBe(1);
    const [session] = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.id, sessionId));
    expect(session?.activeOrganizationId).toBeNull();
    const [user] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, nova.adminUser.id));
    expect(user?.id).toBe(nova.adminUser.id);
    const [neighborIssues] = await db
      .select({ total: count() })
      .from(schema.issue)
      .where(eq(schema.issue.organizationId, orion.organizationId));
    expect(neighborIssues?.total).toBe(3);
  });

  it('keeps a durable retry state when storage cleanup fails', async () => {
    const now = new Date('2026-08-08T13:00:00.000Z');
    const availableAt = new Date(now.getTime() + deletionDrainMilliseconds);
    const sessionId = newId();
    await db.insert(schema.session).values({
      id: sessionId,
      token: newId(),
      userId: nova.adminUser.id,
      activeOrganizationId: nova.organizationId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const storage = fakeStorage(
      { objects: 1, bytes: 12, versions: 1, versionBytes: 12 },
      internal('storage unavailable'),
    );

    await expect(
      deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver, now),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { availableAt: availableAt.toISOString() },
    });
    await expect(
      deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver, availableAt),
    ).rejects.toMatchObject({ code: 'internal' });

    expect(await organizationCount(nova.organizationId)).toBe(1);
    const [session] = await db
      .select({ activeOrganizationId: schema.session.activeOrganizationId })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId));
    expect(session?.activeOrganizationId).toBe(nova.organizationId);
    const [organization] = await db
      .select({ deletionRequestedAt: schema.organization.deletionRequestedAt })
      .from(schema.organization)
      .where(eq(schema.organization.id, nova.organizationId));
    expect(organization?.deletionRequestedAt).toEqual(now);

    const retryStorage = fakeStorage();
    const retried = await deleteOrganization(
      nova.admin,
      { confirmation: 'Nova' },
      retryStorage.driver,
      availableAt,
    );
    expect(retried.deletedOrganizationId).toBe(nova.organizationId);
    expect(retryStorage.deleted).toEqual([`${nova.organizationId}/`]);
    expect(await organizationCount(nova.organizationId)).toBe(0);
  });

  it('keeps a retry state when a final database statement fails after storage cleanup', async () => {
    const now = new Date('2026-08-08T14:00:00.000Z');
    await makeDeletionReady(nova.organizationId, now);
    await db.execute(sql`
      create table organization_deletion_test_blocker (
        organization_id text primary key references organization(id)
      )
    `);
    try {
      await db.execute(sql`
        insert into organization_deletion_test_blocker (organization_id)
        values (${nova.organizationId})
      `);
      const storage = fakeStorage();

      await expect(
        deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver, now),
      ).rejects.toBeDefined();

      expect(storage.deleted).toEqual([`${nova.organizationId}/`]);
      expect(await organizationCount(nova.organizationId)).toBe(1);
      const [organization] = await db
        .select({ deletionRequestedAt: schema.organization.deletionRequestedAt })
        .from(schema.organization)
        .where(eq(schema.organization.id, nova.organizationId));
      expect(organization?.deletionRequestedAt).toBeInstanceOf(Date);

      await db.execute(sql`
        delete from organization_deletion_test_blocker
        where organization_id = ${nova.organizationId}
      `);

      const retried = await deleteOrganization(
        nova.admin,
        { confirmation: 'Nova' },
        storage.driver,
        now,
      );
      expect(retried.deletedOrganizationId).toBe(nova.organizationId);
      expect(storage.deleted).toEqual([`${nova.organizationId}/`, `${nova.organizationId}/`]);
      expect(await organizationCount(nova.organizationId)).toBe(0);
    } finally {
      await db.execute(sql`drop table organization_deletion_test_blocker`);
    }
  });

  it('keeps a retry state when the final database commit fails after storage cleanup', async () => {
    const now = new Date('2026-08-08T15:00:00.000Z');
    await makeDeletionReady(nova.organizationId, now);
    await db.execute(sql`
      create table organization_deletion_commit_blocker (
        organization_id text primary key references organization(id)
          deferrable initially deferred
      )
    `);
    try {
      await db.execute(sql`
        insert into organization_deletion_commit_blocker (organization_id)
        values (${nova.organizationId})
      `);
      const storage = fakeStorage();

      await expect(
        deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver, now),
      ).rejects.toBeDefined();

      expect(storage.deleted).toEqual([`${nova.organizationId}/`]);
      expect(await organizationCount(nova.organizationId)).toBe(1);
      const [organization] = await db
        .select({ deletionRequestedAt: schema.organization.deletionRequestedAt })
        .from(schema.organization)
        .where(eq(schema.organization.id, nova.organizationId));
      expect(organization?.deletionRequestedAt).toBeInstanceOf(Date);

      await db.execute(sql`
        delete from organization_deletion_commit_blocker
        where organization_id = ${nova.organizationId}
      `);

      const retried = await deleteOrganization(
        nova.admin,
        { confirmation: 'Nova' },
        storage.driver,
        now,
      );
      expect(retried.deletedOrganizationId).toBe(nova.organizationId);
      expect(storage.deleted).toEqual([`${nova.organizationId}/`, `${nova.organizationId}/`]);
      expect(await organizationCount(nova.organizationId)).toBe(0);
    } finally {
      await db.execute(sql`drop table organization_deletion_commit_blocker`);
    }
  });

  it('blocks at URL expiry while an upload may still be finishing', async () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    await makeDeletionReady(nova.organizationId, now);
    await db.insert(schema.attachment).values({
      id: newId(),
      organizationId: nova.organizationId,
      parentType: 'issue',
      parentId: 'issue_1',
      fileName: 'expired.txt',
      contentType: 'text/plain',
      size: 1,
      storageKey: `${nova.organizationId}/expired.txt`,
      status: 'pending',
      uploadedById: nova.adminUser.id,
      uploadExpiresAt: now,
    });

    await expect(
      deleteOrganization(nova.admin, { confirmation: 'Nova' }, fakeStorage().driver, now),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: {
        availableAt: new Date(now.getTime() + UPLOAD_COMPLETION_GRACE_SECONDS * 1000).toISOString(),
      },
    });
    expect(await organizationCount(nova.organizationId)).toBe(1);
  });

  it('allows deletion at the exact upload-completion boundary and returns no fallback', async () => {
    const now = new Date('2026-08-08T12:15:00.000Z');
    await makeDeletionReady(nova.organizationId, now);
    const uploadExpiresAt = new Date(now.getTime() - UPLOAD_COMPLETION_GRACE_SECONDS * 1000);
    await db.insert(schema.attachment).values({
      id: newId(),
      organizationId: nova.organizationId,
      parentType: 'issue',
      parentId: 'issue_1',
      fileName: 'expired.txt',
      contentType: 'text/plain',
      size: 1,
      storageKey: `${nova.organizationId}/expired.txt`,
      status: 'pending',
      uploadedById: nova.adminUser.id,
      uploadExpiresAt,
    });

    const result = await deleteOrganization(
      nova.admin,
      { confirmation: 'Nova' },
      fakeStorage().driver,
      now,
    );

    expect(result.nextOrganizationId).toBeNull();
    expect(await organizationCount(nova.organizationId)).toBe(0);
    const [attachment] = await db
      .select({ id: schema.attachment.id })
      .from(schema.attachment)
      .where(
        and(
          eq(schema.attachment.organizationId, nova.organizationId),
          eq(schema.attachment.fileName, 'expired.txt'),
        ),
      );
    expect(attachment).toBeUndefined();
  });

  it('prevents a waiting upload from minting a target after deletion starts', async () => {
    const now = new Date();
    await makeDeletionReady(nova.organizationId, now);
    const { issue } = await createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Upload race',
    });
    let announceDeletion: (() => void) | undefined;
    let releaseDeletion: (() => void) | undefined;
    const deletionStarted = new Promise<void>((resolve) => {
      announceDeletion = resolve;
    });
    const deletionReleased = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const deletionStorage = fakeStorage();
    const blockingDeletionDriver = {
      ...deletionStorage.driver,
      deletePrefix: (prefix: string) => {
        deletionStorage.deleted.push(prefix);
        announceDeletion?.();
        return deletionReleased;
      },
    } as StorageDriver;
    let targetCreated = false;
    const uploadDriver = {
      ...fakeStorage().driver,
      createUploadTarget: (key: string, contentType: string, contentLength: number) => {
        targetCreated = true;
        return Promise.resolve({
          key,
          url: `https://storage.example/${key}`,
          method: 'PUT' as const,
          headers: { 'content-type': contentType },
          maxBytes: contentLength,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      },
    } as StorageDriver;
    const challenger = postgres(databaseUrl(), {
      max: 1,
      idle_timeout: 5,
      onnotice: () => undefined,
    });
    const deleting = deleteOrganization(
      nova.admin,
      { confirmation: 'Nova' },
      blockingDeletionDriver,
      now,
    );
    await deletionStarted;
    const competingLock = challenger`
      select id from organization where id = ${nova.organizationId} for update
    `;
    const uploading = registerUpload(
      nova.admin,
      {
        fileName: 'race.txt',
        contentType: 'text/plain',
        size: 4,
        parentType: 'issue',
        parentId: issue.id,
      },
      uploadDriver,
    ).then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    );
    try {
      const first = await Promise.race([
        competingLock.then(() => 'acquired' as const),
        pause(1_000).then(() => 'timeout' as const),
      ]);
      expect(first).toBe('acquired');
      releaseDeletion?.();
      await deleting;
      await competingLock;
      expect(await uploading).toMatchObject({
        error: { code: 'conflict' },
        status: 'rejected',
      });
      expect(targetCreated).toBe(false);
    } finally {
      releaseDeletion?.();
      await deleting.catch(() => undefined);
      await uploading.catch(() => undefined);
      await competingLock.catch(() => undefined);
      await challenger.end();
    }
  });
});
