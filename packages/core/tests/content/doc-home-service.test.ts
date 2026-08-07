import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import {
  docsHome,
  isFavoriteDoc,
  listRecentDocs,
  recordDocVisit,
  setDocFavorite,
} from '../../src/content/doc-home-service.ts';
import { archiveDoc, createDoc, setDocAccess } from '../../src/content/doc-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newDoc(title: string) {
  const { doc } = await createDoc(workspace.admin, { title, content: `${title} body` });
  return doc;
}

async function visitedAtOf(userId: string, docId: string): Promise<Date> {
  const [row] = await db
    .select({ visitedAt: schema.recentVisit.visitedAt })
    .from(schema.recentVisit)
    .where(eq(schema.recentVisit.entityId, docId));
  if (row === undefined) throw new Error(`no visit recorded for ${userId} on ${docId}`);
  return row.visitedAt;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

async function backdateVisit(docId: string, visitedAt: Date): Promise<Date> {
  await db
    .update(schema.recentVisit)
    .set({ visitedAt })
    .where(eq(schema.recentVisit.entityId, docId));
  return visitedAt;
}

async function backdateDoc(docId: string, updatedAt: Date): Promise<void> {
  await db.update(schema.doc).set({ updatedAt }).where(eq(schema.doc.id, docId));
}

describe('recordDocVisit', () => {
  it('lists what you opened, most recent first', async () => {
    const first = await newDoc('Runbook');
    const second = await newDoc('Postmortem');

    await recordDocVisit(workspace.admin, first.id);
    await backdateVisit(first.id, minutesAgo(10));
    await recordDocVisit(workspace.admin, second.id);
    await backdateVisit(second.id, minutesAgo(5));

    const recent = await listRecentDocs(workspace.admin, 10);
    expect(recent.map((entry) => entry.title)).toEqual(['Postmortem', 'Runbook']);
  });

  it('moves a doc back to the top on a second visit instead of listing it twice', async () => {
    const first = await newDoc('Runbook');
    const second = await newDoc('Postmortem');

    await recordDocVisit(workspace.admin, first.id);
    await recordDocVisit(workspace.admin, second.id);
    await backdateVisit(second.id, minutesAgo(5));
    const before = await backdateVisit(first.id, minutesAgo(10));

    await recordDocVisit(workspace.admin, first.id);

    const recent = await listRecentDocs(workspace.admin, 10);
    expect(recent.map((entry) => entry.title)).toEqual(['Runbook', 'Postmortem']);
    expect((await visitedAtOf(workspace.admin.userId, first.id)).getTime()).toBeGreaterThan(
      before.getTime(),
    );
  });

  it('keeps one person history out of another person history', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mo Member' });
    const doc = await newDoc('Runbook');

    await recordDocVisit(workspace.admin, doc.id);

    expect(await listRecentDocs(member.principal, 10)).toEqual([]);
  });

  it('refuses to record a visit to a doc the caller cannot read', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { doc } = await createDoc(workspace.admin, {
      title: 'Severance terms',
      visibility: 'private',
    });

    await expect(recordDocVisit(member.principal, doc.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('drops a doc from the history once access is revoked', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { doc } = await createDoc(workspace.admin, {
      title: 'Severance terms',
      visibility: 'private',
    });
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: member.principal.userId, level: 'read' }],
    });
    await recordDocVisit(member.principal, doc.id);
    expect(await listRecentDocs(member.principal, 10)).toHaveLength(1);

    await setDocAccess(workspace.admin, doc.id, { grants: [] });

    expect(await listRecentDocs(member.principal, 10)).toEqual([]);
  });

  it('drops an archived doc from the history', async () => {
    const doc = await newDoc('Runbook');
    await recordDocVisit(workspace.admin, doc.id);

    await archiveDoc(workspace.admin, doc.id);

    expect(await listRecentDocs(workspace.admin, 10)).toEqual([]);
  });
});

describe('setDocFavorite', () => {
  it('stars and unstars a doc for the caller alone', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mo Member' });
    const doc = await newDoc('Runbook');

    await setDocFavorite(workspace.admin, doc.id, { favorite: true });

    expect(await isFavoriteDoc(workspace.admin, doc.id)).toBe(true);
    expect(await isFavoriteDoc(member.principal, doc.id)).toBe(false);
    expect((await docsHome(workspace.admin)).favorites.map((entry) => entry.title)).toEqual([
      'Runbook',
    ]);

    await setDocFavorite(workspace.admin, doc.id, { favorite: false });

    expect(await isFavoriteDoc(workspace.admin, doc.id)).toBe(false);
    expect((await docsHome(workspace.admin)).favorites).toEqual([]);
  });

  it('stays a single star when the same doc is starred twice', async () => {
    const doc = await newDoc('Runbook');

    await setDocFavorite(workspace.admin, doc.id, { favorite: true });
    await setDocFavorite(workspace.admin, doc.id, { favorite: true });

    expect((await docsHome(workspace.admin)).favorites).toHaveLength(1);
  });

  it('announces the change to the one person it belongs to and nobody else', async () => {
    const doc = await newDoc('Runbook');

    const { actions } = await setDocFavorite(workspace.admin, doc.id, { favorite: true });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.scopes).toEqual([scopes.user(workspace.admin.userId)]);
    expect(actions[0]?.scopes).not.toContain(scopes.organization(workspace.organizationId));
  });

  it('refuses to star a doc the caller cannot read', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { doc } = await createDoc(workspace.admin, {
      title: 'Severance terms',
      visibility: 'private',
    });

    await expect(
      setDocFavorite(member.principal, doc.id, { favorite: true }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects a body that is not a favorite flag', async () => {
    const doc = await newDoc('Runbook');

    await expect(setDocFavorite(workspace.admin, doc.id, { favorite: 'yes' })).rejects.toThrow();
  });
});

describe('docsHome', () => {
  it('answers with recents, favourites and what changed, newest change first', async () => {
    const runbook = await newDoc('Runbook');
    const postmortem = await newDoc('Postmortem');
    await backdateDoc(runbook.id, minutesAgo(10));
    await backdateDoc(postmortem.id, minutesAgo(5));
    await recordDocVisit(workspace.admin, runbook.id);
    await setDocFavorite(workspace.admin, postmortem.id, { favorite: true });

    const home = await docsHome(workspace.admin);

    expect(home.recent.map((entry) => entry.title)).toEqual(['Runbook']);
    expect(home.favorites.map((entry) => entry.title)).toEqual(['Postmortem']);
    expect(home.updated.map((entry) => entry.title)).toEqual(['Postmortem', 'Runbook']);
  });

  it('keeps a restricted doc out of what changed for someone without a grant', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mo Member' });
    await createDoc(workspace.admin, { title: 'Severance terms', visibility: 'private' });
    await newDoc('Runbook');

    const home = await docsHome(member.principal);

    expect(home.updated.map((entry) => entry.title)).toEqual(['Runbook']);
  });

  it('honours the limit it is asked for', async () => {
    for (const index of [1, 2, 3, 4]) await newDoc(`Doc ${index}`);

    expect((await docsHome(workspace.admin, { limit: 2 })).updated).toHaveLength(2);
  });

  it('refuses a limit outside the range it advertises', async () => {
    await expect(docsHome(workspace.admin, { limit: 0 })).rejects.toThrow();
    await expect(docsHome(workspace.admin, { limit: 500 })).rejects.toThrow();
  });
});
