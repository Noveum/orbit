import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createIssue } from '@orbit/core';
import { addMember } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { ISSUE_DESCRIPTION_MAX_LENGTH } from '@orbit/shared/constants';
import { issueEnvelopeSchema } from '@/lib/query/schemas.ts';
import {
  actorFor,
  buildIssueRoutesWorld,
  contextFor,
  errorSchema,
  ISSUES_BASE,
  type IssueRoutesWorld,
  installRouteMocks,
  issueSchema,
  signInAs,
} from '../../../../../tests-support-issue-routes.ts';

const issueRoute = await import('../../../../../src/app/api/issues/[id]/route.ts');

let world: IssueRoutesWorld;

beforeAll(async () => {
  world = await buildIssueRoutesWorld();
});

beforeEach(() => {
  installRouteMocks();
  signInAs(world.admin);
});

describe('PATCH /api/issues/[id]', () => {
  it('preserves the same complete Agent Actors in GET and Human PATCH responses', async () => {
    const created = await createIssue(world.workspace.admin, {
      teamId: world.workspace.teamId,
      title: 'Actor response fixture',
      assigneeId: null,
    });
    const id = crypto.randomUUID();
    await db.insert(schema.agentIdentity).values({
      id,
      organizationId: world.workspace.organizationId,
      name: 'Build helper',
      avatar: 'https://orbit.test/helper.png',
      deletedAt: new Date(),
      ownerNameSnapshot: world.admin.name,
      clientNameSnapshot: 'Fixture',
    });
    await db
      .update(schema.issue)
      .set({ creatorUserId: null, creatorAgentId: id, assigneeAgentId: id, ownerUserId: null })
      .where(eq(schema.issue.id, created.issue.id));
    const getResponse = await issueRoute.GET(
      new Request(`${ISSUES_BASE}/${created.issue.id}`),
      contextFor(created.issue.id),
    );
    expect(getResponse.status).toBe(200);
    const get = issueEnvelopeSchema.parse(await getResponse.json());
    const expected = {
      type: 'agent',
      id,
      name: 'Build helper',
      avatar: 'https://orbit.test/helper.png',
      deleted: true,
    } as const;
    expect(get.issue.creator).toEqual(expected);
    expect(get.issue.assignee).toEqual(expected);
    expect(get.issue.owner).toBeNull();
    const patchResponse = await issueRoute.PATCH(
      new Request(`${ISSUES_BASE}/${created.issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Human edited title' }),
      }),
      contextFor(created.issue.id),
    );
    expect(patchResponse.status).toBe(200);
    const patch = issueEnvelopeSchema.parse(await patchResponse.json());
    expect(patch.issue.creator).toEqual(get.issue.creator);
    expect(patch.issue.assignee).toEqual(get.issue.assignee);
    expect(patch.issue.owner).toBeNull();
  });

  it('stores a due date the client sends', async () => {
    const response = await issueRoute.PATCH(
      new Request(`${ISSUES_BASE}/${world.second.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ dueDate: '2031-03-04' }),
      }),
      contextFor(world.second.id),
    );

    expect(response.status).toBe(200);
    expect(issueSchema.parse(await response.json()).issue.dueDate).toBe('2031-03-04');
  });

  it('stores a large pasted description', async () => {
    const description = 'x'.repeat(150_000);
    const response = await issueRoute.PATCH(
      new Request(`${ISSUES_BASE}/${world.second.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      }),
      contextFor(world.second.id),
    );

    expect(response.status).toBe(200);
    expect(issueEnvelopeSchema.parse(await response.json()).issue.description).toBe(description);
  });

  it('explains when a description exceeds the request limit', async () => {
    const response = await issueRoute.PATCH(
      new Request(`${ISSUES_BASE}/${world.second.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          description: 'x'.repeat(ISSUE_DESCRIPTION_MAX_LENGTH + 1),
        }),
      }),
      contextFor(world.second.id),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'validation_failed',
        message: 'Description must be 500,000 characters or fewer.',
        details: {
          issues: [
            {
              code: 'too_big',
              path: ['description'],
              message: 'Description must be 500,000 characters or fewer.',
            },
          ],
        },
      },
    });
  });

  it('stores a parent the client sends', async () => {
    const response = await issueRoute.PATCH(
      new Request(`${ISSUES_BASE}/${world.second.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId: world.first.id }),
      }),
      contextFor(world.second.id),
    );

    expect(issueSchema.parse(await response.json()).issue.parentId).toBe(world.first.id);
  });

  it('returns every reviewer after updating the reviewer field', async () => {
    const first = await addMember(world.workspace, 'member', { name: 'First Reviewer' });
    const second = await addMember(world.workspace, 'member', { name: 'Second Reviewer' });
    const response = await issueRoute.PATCH(
      new Request(`${ISSUES_BASE}/${world.second.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewerIds: [first.user.id, second.user.id] }),
      }),
      contextFor(world.second.id),
    );

    expect(response.status).toBe(200);
    expect(issueEnvelopeSchema.parse(await response.json()).issue.reviewerIds).toEqual(
      [first.user.id, second.user.id].sort(),
    );
  });

  it('answers 422 for a due date the client made up, never 500', async () => {
    for (const nonsense of [true, 0, 1_700_000_000_000, 'banana', '+275760-09-13', '10000-01-01']) {
      const response = await issueRoute.PATCH(
        new Request(`${ISSUES_BASE}/${world.second.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ dueDate: nonsense }),
        }),
        contextFor(world.second.id),
      );

      expect({ sent: nonsense, status: response.status }).toEqual({
        sent: nonsense,
        status: 422,
      });
      expect(errorSchema.parse(await response.json()).error.code).toBe('validation_failed');
    }
  });

  it('refuses a parent in a team the caller cannot see', async () => {
    const mine = await createIssue(world.workspace.admin, {
      teamId: world.workspace.teamId,
      title: 'Mine',
    });
    const { user } = await addMember(world.workspace, 'member', { name: 'Mel Member' });
    signInAs(await actorFor(user));

    const response = await issueRoute.PATCH(
      new Request(`${ISSUES_BASE}/${mine.issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId: world.hidden.id }),
      }),
      contextFor(mine.issue.id),
    );

    expect(response.status).toBe(404);
  });
});
