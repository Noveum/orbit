import { describe, expect, it } from 'bun:test';
import { doc, organization, project, user } from '@orbit/db/schema';
import { DomainError } from '@orbit/shared';
import type { OrgRole } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { randomUUIDv7 } from 'bun';
import { type TestTransaction, withRollback } from '../test-database.ts';
import { assertUploadParent, isPubliclyReadable } from './parent.ts';

interface Fixture {
  readonly organizationId: string;
  readonly userId: string;
  readonly workspaceDocId: string;
  readonly publishedDocId: string;
  readonly archivedDocId: string;
  readonly projectId: string;
}

async function seed(tx: TestTransaction): Promise<Fixture> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  const userId = `usr_${suffix}`;
  await tx
    .insert(organization)
    .values({ id: organizationId, name: 'Acme', slug: `acme-${suffix.toLowerCase()}` });
  await tx.insert(user).values({
    id: userId,
    name: 'Ada',
    email: `ada.${suffix}@orbit.local`,
    handle: `ada-${suffix.toLowerCase()}`,
  });
  const docs = [
    { id: `doc_ws_${suffix}`, title: 'Internal', visibility: 'workspace', archivedAt: null },
    { id: `doc_pub_${suffix}`, title: 'Public', visibility: 'public', archivedAt: null },
    { id: `doc_arc_${suffix}`, title: 'Old', visibility: 'public', archivedAt: new Date() },
  ];
  await tx
    .insert(doc)
    .values(docs.map((row) => ({ ...row, organizationId, authorId: userId, content: '' })));
  const projectId = `prj_${suffix}`;
  await tx
    .insert(project)
    .values({ id: projectId, organizationId, name: 'Apollo', slug: `apollo-${suffix}` });

  return {
    organizationId,
    userId,
    workspaceDocId: `doc_ws_${suffix}`,
    publishedDocId: `doc_pub_${suffix}`,
    archivedDocId: `doc_arc_${suffix}`,
    projectId,
  };
}

function principalFor(fixture: Fixture, role: OrgRole): Principal {
  return { userId: fixture.userId, organizationId: fixture.organizationId, role, teamIds: [] };
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof DomainError) return error.status;
    throw error;
  }
}

describe('assertUploadParent', () => {
  it('lets a member attach to a doc in its own organization', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const member = principalFor(fixture, 'member');
      await assertUploadParent(tx, member, 'doc', fixture.workspaceDocId);
      await assertUploadParent(tx, member, 'project', fixture.projectId);
    });
  });

  it('refuses a contributor attaching to a published doc it cannot write', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const contributor = principalFor(fixture, 'contributor');
      expect(
        await statusOf(() => assertUploadParent(tx, contributor, 'doc', fixture.publishedDocId)),
      ).toBe(403);
      expect(
        await statusOf(() => assertUploadParent(tx, contributor, 'doc', fixture.workspaceDocId)),
      ).toBe(403);
    });
  });

  it('refuses a guest that cannot upload at all', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      expect(
        await statusOf(() =>
          assertUploadParent(tx, principalFor(fixture, 'guest'), 'project', fixture.projectId),
        ),
      ).toBe(403);
    });
  });

  it('404s a parent that belongs to another organization or does not exist', async () => {
    await withRollback(async (tx) => {
      const mine = await seed(tx);
      const theirs = await seed(tx);
      const member = principalFor(mine, 'member');

      for (const parent of [
        ['doc', theirs.workspaceDocId],
        ['project', theirs.projectId],
        ['doc', 'doc_missing'],
        ['issue', 'iss_missing'],
        ['comment', 'cmt_missing'],
        ['project', 'prj_missing'],
      ] as const) {
        expect(await statusOf(() => assertUploadParent(tx, member, parent[0], parent[1]))).toBe(
          404,
        );
      }
    });
  });

  it('404s an archived doc rather than accepting new attachments', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      expect(
        await statusOf(() =>
          assertUploadParent(tx, principalFor(fixture, 'admin'), 'doc', fixture.archivedDocId),
        ),
      ).toBe(404);
    });
  });
});

describe('isPubliclyReadable', () => {
  it('is true only for a live published doc in the attachment organization', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const owner = { organizationId: fixture.organizationId, parentType: 'doc' };

      expect(await isPubliclyReadable(tx, { ...owner, parentId: fixture.publishedDocId })).toBe(
        true,
      );
      expect(await isPubliclyReadable(tx, { ...owner, parentId: fixture.workspaceDocId })).toBe(
        false,
      );
      expect(await isPubliclyReadable(tx, { ...owner, parentId: fixture.archivedDocId })).toBe(
        false,
      );
    });
  });

  it('never serves an attachment whose parent id points outside its organization', async () => {
    await withRollback(async (tx) => {
      const mine = await seed(tx);
      const theirs = await seed(tx);

      expect(
        await isPubliclyReadable(tx, {
          organizationId: mine.organizationId,
          parentType: 'doc',
          parentId: theirs.publishedDocId,
        }),
      ).toBe(false);
    });
  });

  it('is false for every parent type that is not a doc', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      for (const parentType of ['issue', 'comment', 'project']) {
        expect(
          await isPubliclyReadable(tx, {
            organizationId: fixture.organizationId,
            parentType,
            parentId: fixture.publishedDocId,
          }),
        ).toBe(false);
      }
    });
  });
});
