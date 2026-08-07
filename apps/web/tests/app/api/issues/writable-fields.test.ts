import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createComment, createIssue, createTeam, resolvePrincipal } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import type { StorageDriver } from '@orbit/services/storage';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import { mockMembership, mockSession } from '../../../../tests-support.ts';

const storageModule = await import('@orbit/services/storage');

const puts: string[] = [];
const fakeDriver = {
  name: 's3',
  createUploadTarget: (key: string, contentType: string, contentLength: number) => {
    puts.push(key);
    return Promise.resolve({
      key,
      url: `https://storage.test/${key}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
      maxBytes: contentLength,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  },
  put: () => Promise.resolve(),
  getUrl: () => Promise.reject(new Error('unused')),
  delete: () => Promise.resolve(),
  stat: () => Promise.resolve(null),
} as unknown as StorageDriver;

function installStorageMock(): void {
  mock.module('@orbit/services/storage', () => ({
    ...storageModule,
    storageDriver: () => fakeDriver,
  }));
}

installStorageMock();

interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const signedIn: { value: { user: SessionUser; session: { activeOrganizationId: string } } | null } =
  { value: null };

const membership: { value: MembershipContext | null } = { value: null };

function installSessionMock(): void {
  mockSession(() => signedIn.value);
  mockMembership(() => membership.value);
}

installSessionMock();

const relations = await import('../../../../src/app/api/issues/[id]/relations/route.ts');
const issueRoute = await import('../../../../src/app/api/issues/[id]/route.ts');
const presign = await import('../../../../src/app/api/attachments/presign/route.ts');

const relationListSchema = z.object({
  relations: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      issue: z.object({ id: z.string(), identifier: z.string(), title: z.string() }),
    }),
  ),
});

const issueSchema = z.object({
  issue: z.object({
    id: z.string(),
    dueDate: z.string().nullable(),
    parentId: z.string().nullable(),
  }),
});

const errorSchema = z.object({ error: z.object({ code: z.string() }) });

let nova: Workspace;
let adminUser: Actor;
let outsider: Actor;
let guestUser: Actor;
let first: { id: string; identifier: string };
let second: { id: string; identifier: string };
let hidden: { id: string };
let hiddenCommentId: string;
let openCommentId: string;

function contextFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

interface Actor {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly principal: Principal;
}

async function actorFor(user: { id: string; name: string; email: string }): Promise<Actor> {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    principal: await resolvePrincipal(user.id, nova.organizationId),
  };
}

function signInAs(person: Actor): void {
  signedIn.value = {
    user: { id: person.userId, name: person.name, email: person.email },
    session: { activeOrganizationId: nova.organizationId },
  };
  membership.value = {
    principal: person.principal,
    memberId: `member_${person.userId}`,
    organizationName: 'Nova',
    organizationSlug: 'nova',
  };
}

beforeAll(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');

  adminUser = await actorFor(nova.adminUser);
  const away = await addMember(nova, 'member', { name: 'Odie Outsider', teamIds: [] });
  outsider = await actorFor(away.user);
  const visiting = await addMember(nova, 'guest', { name: 'Gus Guest' });
  guestUser = await actorFor(visiting.user);

  const one = await createIssue(nova.admin, { teamId: nova.teamId, title: 'Blocks the other' });
  first = { id: one.issue.id, identifier: one.issue.identifier };
  const two = await createIssue(nova.admin, { teamId: nova.teamId, title: 'Blocked by the first' });
  second = { id: two.issue.id, identifier: two.issue.identifier };
  const open = await createComment(nova.admin, one.issue.id, { body: 'Out in the open' });
  openCommentId = open.comment.id;

  const walled = await createTeam(nova.admin, { name: 'Design', key: 'DSGN' });
  const state = walled.states[0];
  if (state === undefined) throw new Error('missing state');
  const behind = await createIssue(nova.admin, {
    teamId: walled.team.id,
    title: 'Behind the wall',
    stateId: state.id,
  });
  hidden = { id: behind.issue.id };
  const secret = await createComment(nova.admin, behind.issue.id, { body: 'Private' });
  hiddenCommentId = secret.comment.id;
});

beforeEach(() => {
  installSessionMock();
  installStorageMock();
  signInAs(adminUser);
  puts.length = 0;
});

const BASE = 'http://localhost:3000/api/issues';

async function createRelation(
  issueId: string,
  relatedIssueId: string,
  type: string,
): Promise<void> {
  const signedInBefore = signedIn.value;
  const membershipBefore = membership.value;
  signInAs(adminUser);
  const response = await relations.POST(
    new Request(`${BASE}/${issueId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ relatedIssueId, type }),
    }),
    contextFor(issueId),
  );
  if (response.status !== 200) throw new Error(`the relation was not written: ${response.status}`);
  signedIn.value = signedInBefore;
  membership.value = membershipBefore;
}

describe('POST /api/issues/[id]/relations', () => {
  it('writes both directions and lists the related issue back', async () => {
    const response = await relations.POST(
      new Request(`${BASE}/${first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: second.id, type: 'blocks' }),
      }),
      contextFor(first.id),
    );

    expect(response.status).toBe(200);
    const payload = relationListSchema.parse(await response.json());
    expect(payload.relations).toHaveLength(1);
    expect(payload.relations[0]?.type).toBe('blocks');
    expect(payload.relations[0]?.issue.identifier).toBe(second.identifier);

    const inverse = relationListSchema.parse(
      await (
        await relations.GET(new Request(`${BASE}/${second.id}/relations`), contextFor(second.id))
      ).json(),
    );
    expect(inverse.relations[0]?.type).toBe('blocked_by');
  });

  it('refuses a caller who is not in the team of the issue', async () => {
    signInAs(outsider);

    const response = await relations.POST(
      new Request(`${BASE}/${first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: second.id, type: 'related' }),
      }),
      contextFor(first.id),
    );

    expect(response.status).toBe(404);
    expect(errorSchema.parse(await response.json()).error.code).toBe('not_found');
  });

  it('refuses a guest, whose role cannot update an issue', async () => {
    signInAs(guestUser);

    const response = await relations.POST(
      new Request(`${BASE}/${first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: second.id, type: 'related' }),
      }),
      contextFor(first.id),
    );

    expect(response.status).toBe(403);
    expect(errorSchema.parse(await response.json()).error.code).toBe('forbidden');
  });

  it('rejects a relation type the contract does not know', async () => {
    const response = await relations.POST(
      new Request(`${BASE}/${first.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: second.id, type: 'supersedes' }),
      }),
      contextFor(first.id),
    );

    expect(response.status).toBe(422);
  });
});

describe('DELETE /api/issues/[id]/relations', () => {
  it('removes both directions and answers with what is left', async () => {
    const left = await createIssue(nova.admin, { teamId: nova.teamId, title: 'Left' });
    const right = await createIssue(nova.admin, { teamId: nova.teamId, title: 'Right' });
    await relations.POST(
      new Request(`${BASE}/${left.issue.id}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId: right.issue.id, type: 'related' }),
      }),
      contextFor(left.issue.id),
    );

    const response = await relations.DELETE(
      new Request(
        `${BASE}/${left.issue.id}/relations?relatedIssueId=${right.issue.id}&type=related`,
        { method: 'DELETE' },
      ),
      contextFor(left.issue.id),
    );

    expect(response.status).toBe(200);
    expect(relationListSchema.parse(await response.json()).relations).toEqual([]);
    const inverse = relationListSchema.parse(
      await (
        await relations.GET(
          new Request(`${BASE}/${right.issue.id}/relations`),
          contextFor(right.issue.id),
        )
      ).json(),
    );
    expect(inverse.relations).toEqual([]);
  });

  it('refuses a guest, whose role cannot update an issue', async () => {
    signInAs(guestUser);

    const response = await relations.DELETE(
      new Request(`${BASE}/${first.id}/relations?relatedIssueId=${second.id}&type=blocks`, {
        method: 'DELETE',
      }),
      contextFor(first.id),
    );

    expect(response.status).toBe(403);
  });

  it('refuses to unlink an issue the caller cannot see from the end they can', async () => {
    const mine = await createIssue(nova.admin, { teamId: nova.teamId, title: 'Reaches over' });
    await createRelation(mine.issue.id, hidden.id, 'blocks');
    const { user } = await addMember(nova, 'member', { name: 'Ida Insider' });
    signInAs(await actorFor(user));

    const response = await relations.DELETE(
      new Request(`${BASE}/${mine.issue.id}/relations?relatedIssueId=${hidden.id}&type=blocks`, {
        method: 'DELETE',
      }),
      contextFor(mine.issue.id),
    );

    expect(response.status).toBe(404);

    signInAs(adminUser);
    const left = relationListSchema.parse(
      await (
        await relations.GET(new Request(`${BASE}/${hidden.id}/relations`), contextFor(hidden.id))
      ).json(),
    );
    expect(left.relations).toHaveLength(1);
  });
});

describe('GET /api/issues/[id]/relations', () => {
  it('refuses to show the relations of an issue in a team the caller cannot see', async () => {
    signInAs(outsider);

    const response = await relations.GET(
      new Request(`${BASE}/${hidden.id}/relations`),
      contextFor(hidden.id),
    );

    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/issues/[id]', () => {
  it('stores a due date the client sends', async () => {
    const response = await issueRoute.PATCH(
      new Request(`${BASE}/${second.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ dueDate: '2031-03-04' }),
      }),
      contextFor(second.id),
    );

    expect(response.status).toBe(200);
    expect(issueSchema.parse(await response.json()).issue.dueDate).toBe('2031-03-04');
  });

  it('stores a parent the client sends', async () => {
    const response = await issueRoute.PATCH(
      new Request(`${BASE}/${second.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId: first.id }),
      }),
      contextFor(second.id),
    );

    expect(issueSchema.parse(await response.json()).issue.parentId).toBe(first.id);
  });

  it('answers 422 for a due date the client made up, never 500', async () => {
    for (const nonsense of [true, 0, 1_700_000_000_000, 'banana', '+275760-09-13', '10000-01-01']) {
      const response = await issueRoute.PATCH(
        new Request(`${BASE}/${second.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ dueDate: nonsense }),
        }),
        contextFor(second.id),
      );

      expect({ sent: nonsense, status: response.status }).toEqual({
        sent: nonsense,
        status: 422,
      });
      expect(errorSchema.parse(await response.json()).error.code).toBe('validation_failed');
    }
  });

  it('refuses a parent in a team the caller cannot see', async () => {
    const mine = await createIssue(nova.admin, { teamId: nova.teamId, title: 'Mine' });
    const { user } = await addMember(nova, 'member', { name: 'Mel Member' });
    signInAs(await actorFor(user));

    const response = await issueRoute.PATCH(
      new Request(`${BASE}/${mine.issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId: hidden.id }),
      }),
      contextFor(mine.issue.id),
    );

    expect(response.status).toBe(404);
  });
});

describe('POST /api/attachments/presign', () => {
  it('registers an upload against a comment the caller can read', async () => {
    const response = await presign.POST(
      new Request('http://localhost:3000/api/attachments/presign', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'trace.log',
          contentType: 'text/plain',
          size: 24,
          parentType: 'comment',
          parentId: openCommentId,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = z
      .object({
        attachment: z.object({ parentType: z.string(), parentId: z.string() }),
        upload: z.object({ key: z.string(), method: z.literal('PUT') }),
      })
      .parse(await response.json());
    expect(payload.attachment).toEqual({ parentType: 'comment', parentId: openCommentId });
    expect(puts).toHaveLength(1);
  });

  it('refuses a comment on an issue the caller cannot see', async () => {
    signInAs(outsider);

    const response = await presign.POST(
      new Request('http://localhost:3000/api/attachments/presign', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'trace.log',
          contentType: 'text/plain',
          size: 24,
          parentType: 'comment',
          parentId: hiddenCommentId,
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(puts).toHaveLength(0);
  });

  it('refuses a guest, whose role cannot upload', async () => {
    signInAs(guestUser);

    const response = await presign.POST(
      new Request('http://localhost:3000/api/attachments/presign', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'trace.log',
          contentType: 'text/plain',
          size: 24,
          parentType: 'comment',
          parentId: openCommentId,
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(puts).toHaveLength(0);
  });
});
