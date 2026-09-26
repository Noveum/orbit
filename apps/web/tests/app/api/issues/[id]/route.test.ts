import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createIssue } from '@orbit/core';
import { addMember } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { ISSUE_DESCRIPTION_MAX_LENGTH } from '@orbit/shared/constants';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';
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

const detailSchema = z.object({
  activity: z.array(z.record(z.string(), z.unknown())),
});

async function seedAgentActivity(issueId: string): Promise<void> {
  await db.insert(schema.oauthApplication).values({
    id: randomUUIDv7(),
    clientId: 'client_read_path',
    name: 'Read Path Client',
    redirectUrls: 'https://example.com/callback',
    type: 'public',
  });
  const [identity] = await db
    .insert(schema.agentIdentity)
    .values({
      id: randomUUIDv7(),
      organizationId: world.workspace.organizationId,
      ownerUserId: world.admin.userId,
      ownerNameSnapshot: world.admin.name,
      clientId: 'client_read_path',
      clientNameSnapshot: 'Read Path Client',
      name: 'Scout',
      avatar: null,
    })
    .returning();
  if (identity === undefined) throw new Error('identity was not written');
  const grantId = randomUUIDv7();
  await db.insert(schema.mcpGrant).values({
    id: grantId,
    clientId: 'client_read_path',
    userId: world.admin.userId,
    organizationId: world.workspace.organizationId,
    scopes: 'orbit.read',
    agentIdentityId: identity.id,
    principalNameSnapshot: world.admin.name,
  });
  await db.insert(schema.issueActivity).values({
    id: randomUUIDv7(),
    organizationId: world.workspace.organizationId,
    issueId,
    actorType: 'agent',
    actorId: identity.id,
    actorName: 'Scout',
    actorAvatar: 'https://avatars.test/scout.png',
    principalUserId: world.admin.userId,
    principalName: 'Ada Admin',
    principalAvatar: 'https://avatars.test/ada.png',
    grantId,
    field: 'stateId',
    fromValue: 'state_one',
    toValue: 'state_two',
    syncId: 1,
  });
}

function findKeys(value: unknown, wanted: ReadonlySet<string>, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) findKeys(item, wanted, found);
    return found;
  }
  if (value === null || typeof value !== 'object') return found;
  for (const [key, nested] of Object.entries(value)) {
    if (wanted.has(key)) found.push(key);
    findKeys(nested, wanted, found);
  }
  return found;
}

describe('GET /api/issues/[id] attribution', () => {
  it('hands the reader the actor and the principal, never the grant', async () => {
    await seedAgentActivity(world.second.id);

    const response = await issueRoute.GET(
      new Request(`${ISSUES_BASE}/${world.second.id}`),
      contextFor(world.second.id),
    );
    const body: unknown = await response.json();
    const entry = detailSchema.parse(body).activity.at(-1);

    expect(response.status).toBe(200);
    expect(entry).toMatchObject({
      actorType: 'agent',
      actorName: 'Scout',
      actorAvatar: 'https://avatars.test/scout.png',
      principalName: 'Ada Admin',
      principalAvatar: 'https://avatars.test/ada.png',
    });
    expect(findKeys(body, new Set(['grantId', 'grant_id', 'principalUserId']))).toEqual([]);
  });
});
