import { beforeEach, describe, expect, it } from 'bun:test';
import { and, count, db, eq, schema, sql } from '@orbit/db';
import {
  type StorageDriver,
  type StoragePrefixSummary,
  UPLOAD_COMPLETION_GRACE_SECONDS,
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

async function waitForDatabaseLock(client: ReturnType<typeof postgres>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await client<{ waiting: number }[]>`
      select count(*)::int as waiting
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
    `;
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await pause(10);
  }
  throw new Error('The upload did not wait for workspace deletion.');
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

    const result = await deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver);

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
      now,
    );
    expect(retried.deletedOrganizationId).toBe(nova.organizationId);
    expect(retryStorage.deleted).toEqual([`${nova.organizationId}/`]);
    expect(await organizationCount(nova.organizationId)).toBe(0);
  });

  it('finishes every fallible database mutation before deleting storage', async () => {
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
        deleteOrganization(nova.admin, { confirmation: 'Nova' }, storage.driver),
      ).rejects.toBeDefined();

      expect(storage.deleted).toEqual([]);
      expect(await organizationCount(nova.organizationId)).toBe(1);
      const [organization] = await db
        .select({ deletionRequestedAt: schema.organization.deletionRequestedAt })
        .from(schema.organization)
        .where(eq(schema.organization.id, nova.organizationId));
      expect(organization?.deletionRequestedAt).toBeInstanceOf(Date);
    } finally {
      await db.execute(sql`drop table organization_deletion_test_blocker`);
    }
  });

  it('blocks at URL expiry while an upload may still be finishing', async () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
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
    const monitor = postgres(databaseUrl(), {
      max: 1,
      idle_timeout: 5,
      onnotice: () => undefined,
    });
    const deleting = deleteOrganization(
      nova.admin,
      { confirmation: 'Nova' },
      blockingDeletionDriver,
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
    );
    try {
      const first = await Promise.race([
        competingLock.then(() => 'acquired' as const),
        waitForDatabaseLock(monitor).then(() => 'lock' as const),
      ]);
      expect(first).toBe('lock');
      releaseDeletion?.();
      await deleting;
      await competingLock;
      await expect(uploading).rejects.toMatchObject({ code: 'not_found' });
      expect(targetCreated).toBe(false);
    } finally {
      releaseDeletion?.();
      await deleting.catch(() => undefined);
      await uploading.catch(() => undefined);
      await competingLock.catch(() => undefined);
      await challenger.end();
      await monitor.end();
    }
  });
});
