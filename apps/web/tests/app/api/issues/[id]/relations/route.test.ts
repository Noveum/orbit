import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createIssue } from '@orbit/core';
import { addMember } from '@orbit/core/test-support';
import {
  actorFor,
  buildIssueRoutesWorld,
  contextFor,
  errorSchema,
  ISSUES_BASE,
  type IssueRoutesWorld,
  installRouteMocks,
  relationListSchema,
  restoreSignIn,
  signedInSnapshot,
  signInAs,
} from '../../../../../../tests-support-issue-routes.ts';

const relations = await import('../../../../../../src/app/api/issues/[id]/relations/route.ts');

let world: IssueRoutesWorld;

beforeAll(async () => {
  world = await buildIssueRoutesWorld();
});

beforeEach(() => {
  installRouteMocks();
  signInAs(world.admin);
});

async function createRelation(
  issueId: string,
  relatedIssueId: string,
  type: string,
): Promise<void> {
  const before = signedInSnapshot();
  signInAs(world.admin);
  const response = await relations.POST(
    new Request(`${ISSUES_BASE}/${issueId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ relatedIssueId, type }),
    }),
    contextFor(issueId),
  );
  if (response.status !== 200) throw new Error(`the relation was not written: ${response.status}`);
  restoreSignIn(before);
}

describe('POST /api/issues/[id]/relations', () => {
  it('writes both directions and lists the related issue back', async () => {
    const response = await relations.POST(
      new Request(`${ISSUES_BASE}/${world.first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: world.second.id, type: 'blocks' }),
      }),
      contextFor(world.first.id),
    );

    expect(response.status).toBe(200);
    const payload = relationListSchema.parse(await response.json());
    expect(payload.relations).toHaveLength(1);
    expect(payload.relations[0]?.type).toBe('blocks');
    expect(payload.relations[0]?.issue.identifier).toBe(world.second.identifier);

    const inverse = relationListSchema.parse(
      await (
        await relations.GET(
          new Request(`${ISSUES_BASE}/${world.second.id}/relations`),
          contextFor(world.second.id),
        )
      ).json(),
    );
    expect(inverse.relations[0]?.type).toBe('blocked_by');
  });

  it('refuses a caller who is not in the team of the issue', async () => {
    signInAs(world.outsider);

    const response = await relations.POST(
      new Request(`${ISSUES_BASE}/${world.first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: world.second.id, type: 'related' }),
      }),
      contextFor(world.first.id),
    );

    expect(response.status).toBe(404);
    expect(errorSchema.parse(await response.json()).error.code).toBe('not_found');
  });

  it('refuses a guest, whose role cannot update an issue', async () => {
    signInAs(world.guest);

    const response = await relations.POST(
      new Request(`${ISSUES_BASE}/${world.first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: world.second.id, type: 'related' }),
      }),
      contextFor(world.first.id),
    );

    expect(response.status).toBe(403);
    expect(errorSchema.parse(await response.json()).error.code).toBe('forbidden');
  });

  it('rejects a relation type the contract does not know', async () => {
    const response = await relations.POST(
      new Request(`${ISSUES_BASE}/${world.first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: world.second.id, type: 'supersedes' }),
      }),
      contextFor(world.first.id),
    );

    expect(response.status).toBe(422);
  });
});

describe('DELETE /api/issues/[id]/relations', () => {
  it('removes both directions and answers with what is left', async () => {
    const left = await createIssue(world.workspace.admin, {
      teamId: world.workspace.teamId,
      title: 'Left',
    });
    const right = await createIssue(world.workspace.admin, {
      teamId: world.workspace.teamId,
      title: 'Right',
    });
    await relations.POST(
      new Request(`${ISSUES_BASE}/${left.issue.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: right.issue.id, type: 'related' }),
      }),
      contextFor(left.issue.id),
    );

    const response = await relations.DELETE(
      new Request(
        `${ISSUES_BASE}/${left.issue.id}/relations?relatedIssueId=${right.issue.id}&type=related`,
        { method: 'DELETE' },
      ),
      contextFor(left.issue.id),
    );

    expect(response.status).toBe(200);
    expect(relationListSchema.parse(await response.json()).relations).toEqual([]);
    const inverse = relationListSchema.parse(
      await (
        await relations.GET(
          new Request(`${ISSUES_BASE}/${right.issue.id}/relations`),
          contextFor(right.issue.id),
        )
      ).json(),
    );
    expect(inverse.relations).toEqual([]);
  });

  it('refuses a guest, whose role cannot update an issue', async () => {
    signInAs(world.guest);

    const response = await relations.DELETE(
      new Request(
        `${ISSUES_BASE}/${world.first.id}/relations?relatedIssueId=${world.second.id}&type=blocks`,
        { method: 'DELETE' },
      ),
      contextFor(world.first.id),
    );

    expect(response.status).toBe(403);
  });

  it('refuses to unlink an issue the caller cannot see from the end they can', async () => {
    const mine = await createIssue(world.workspace.admin, {
      teamId: world.workspace.teamId,
      title: 'Reaches over',
    });
    await createRelation(mine.issue.id, world.hidden.id, 'blocks');
    const { user } = await addMember(world.workspace, 'member', { name: 'Ida Insider' });
    signInAs(await actorFor(user));

    const response = await relations.DELETE(
      new Request(
        `${ISSUES_BASE}/${mine.issue.id}/relations?relatedIssueId=${world.hidden.id}&type=blocks`,
        { method: 'DELETE' },
      ),
      contextFor(mine.issue.id),
    );

    expect(response.status).toBe(404);

    signInAs(world.admin);
    const left = relationListSchema.parse(
      await (
        await relations.GET(
          new Request(`${ISSUES_BASE}/${world.hidden.id}/relations`),
          contextFor(world.hidden.id),
        )
      ).json(),
    );
    expect(left.relations).toHaveLength(1);
  });
});

describe('GET /api/issues/[id]/relations', () => {
  it('refuses to show the relations of an issue in a team the caller cannot see', async () => {
    signInAs(world.outsider);

    const response = await relations.GET(
      new Request(`${ISSUES_BASE}/${world.hidden.id}/relations`),
      contextFor(world.hidden.id),
    );

    expect(response.status).toBe(404);
  });
});
