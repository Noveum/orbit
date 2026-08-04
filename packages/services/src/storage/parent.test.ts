import { describe, expect, it } from 'bun:test';
import {
  comment,
  doc,
  issue,
  organization,
  project,
  projectTeam,
  team,
  user,
  workflowState,
} from '@orbit/db/schema';
import { DomainError } from '@orbit/shared';
import type { OrgRole } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { type TestTransaction, withRollback } from '../test-database.ts';
import { assertAttachmentVisible, assertUploadParent, isPubliclyReadable } from './parent.ts';

interface Fixture {
  readonly organizationId: string;
  readonly userId: string;
  readonly workspaceDocId: string;
  readonly publishedDocId: string;
  readonly archivedDocId: string;
  readonly projectId: string;
  readonly openTeamId: string;
  readonly closedTeamId: string;
  readonly openIssueId: string;
  readonly closedIssueId: string;
  readonly closedCommentId: string;
  readonly closedProjectId: string;
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

  const openTeamId = `team_open_${suffix}`;
  const closedTeamId = `team_closed_${suffix}`;
  await tx.insert(team).values([
    { id: openTeamId, organizationId, name: 'Open', key: `OP${suffix.slice(0, 4)}` },
    { id: closedTeamId, organizationId, name: 'Closed', key: `CL${suffix.slice(0, 4)}` },
  ]);

  const openStateId = `st_open_${suffix}`;
  const closedStateId = `st_closed_${suffix}`;
  await tx.insert(workflowState).values([
    {
      id: openStateId,
      organizationId,
      teamId: openTeamId,
      name: 'Todo',
      category: 'unstarted',
      color: '#888888',
      position: 0,
    },
    {
      id: closedStateId,
      organizationId,
      teamId: closedTeamId,
      name: 'Todo',
      category: 'unstarted',
      color: '#888888',
      position: 0,
    },
  ]);

  const openIssueId = `iss_open_${suffix}`;
  const closedIssueId = `iss_closed_${suffix}`;
  await tx.insert(issue).values([
    {
      id: openIssueId,
      organizationId,
      teamId: openTeamId,
      number: 1,
      identifier: `OP${suffix.slice(0, 4)}-1`,
      title: 'Mine',
      stateId: openStateId,
      creatorId: userId,
    },
    {
      id: closedIssueId,
      organizationId,
      teamId: closedTeamId,
      number: 1,
      identifier: `CL${suffix.slice(0, 4)}-1`,
      title: 'Not mine',
      stateId: closedStateId,
      creatorId: userId,
    },
  ]);

  const closedCommentId = `cmt_closed_${suffix}`;
  await tx.insert(comment).values({
    id: closedCommentId,
    organizationId,
    issueId: closedIssueId,
    authorId: userId,
    body: 'Private discussion',
  });

  const closedProjectId = `prj_closed_${suffix}`;
  await tx.insert(project).values({
    id: closedProjectId,
    organizationId,
    name: 'Secret',
    slug: `secret-${suffix}`,
  });
  await tx
    .insert(projectTeam)
    .values({ id: `pt_${suffix}`, projectId: closedProjectId, teamId: closedTeamId });

  return {
    organizationId,
    userId,
    workspaceDocId: `doc_ws_${suffix}`,
    publishedDocId: `doc_pub_${suffix}`,
    archivedDocId: `doc_arc_${suffix}`,
    projectId,
    openTeamId,
    closedTeamId,
    openIssueId,
    closedIssueId,
    closedCommentId,
    closedProjectId,
  };
}

function principalFor(fixture: Fixture, role: OrgRole, teamIds: readonly string[] = []): Principal {
  return {
    userId: fixture.userId,
    organizationId: fixture.organizationId,
    role,
    teamIds: [...teamIds],
  };
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

describe('team scoped attachment visibility', () => {
  it('serves a file attached to an issue in a team the reader belongs to', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const member = principalFor(fixture, 'member', [fixture.openTeamId]);
      await assertAttachmentVisible(tx, member, {
        organizationId: fixture.organizationId,
        parentType: 'issue',
        parentId: fixture.openIssueId,
      });
    });
  });

  it('hides a file attached to an issue in a team the reader is not on', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const member = principalFor(fixture, 'member', [fixture.openTeamId]);
      expect(
        await statusOf(() =>
          assertAttachmentVisible(tx, member, {
            organizationId: fixture.organizationId,
            parentType: 'issue',
            parentId: fixture.closedIssueId,
          }),
        ),
      ).toBe(404);
    });
  });

  it('hides a file attached to a comment on an issue in another team', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const member = principalFor(fixture, 'member', [fixture.openTeamId]);
      expect(
        await statusOf(() =>
          assertAttachmentVisible(tx, member, {
            organizationId: fixture.organizationId,
            parentType: 'comment',
            parentId: fixture.closedCommentId,
          }),
        ),
      ).toBe(404);
    });
  });

  it('hides a file attached to a project owned by another team', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const member = principalFor(fixture, 'member', [fixture.openTeamId]);
      expect(
        await statusOf(() =>
          assertAttachmentVisible(tx, member, {
            organizationId: fixture.organizationId,
            parentType: 'project',
            parentId: fixture.closedProjectId,
          }),
        ),
      ).toBe(404);
    });
  });

  it('lets an admin read across every team', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const admin = principalFor(fixture, 'admin');
      for (const parent of [
        ['issue', fixture.closedIssueId],
        ['comment', fixture.closedCommentId],
        ['project', fixture.closedProjectId],
      ] as const) {
        await assertAttachmentVisible(tx, admin, {
          organizationId: fixture.organizationId,
          parentType: parent[0],
          parentId: parent[1],
        });
      }
    });
  });

  it('never crosses an organization boundary', async () => {
    await withRollback(async (tx) => {
      const mine = await seed(tx);
      const theirs = await seed(tx);
      expect(
        await statusOf(() =>
          assertAttachmentVisible(tx, principalFor(mine, 'admin'), {
            organizationId: theirs.organizationId,
            parentType: 'issue',
            parentId: theirs.openIssueId,
          }),
        ),
      ).toBe(404);
    });
  });
});

describe('team scoped attachment upload', () => {
  it('refuses an upload onto an issue in a team the uploader is not on', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const member = principalFor(fixture, 'member', [fixture.openTeamId]);
      await assertUploadParent(tx, member, 'issue', fixture.openIssueId);
      expect(
        await statusOf(() => assertUploadParent(tx, member, 'issue', fixture.closedIssueId)),
      ).toBe(404);
    });
  });
});
