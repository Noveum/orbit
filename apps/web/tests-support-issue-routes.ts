import { mock } from 'bun:test';
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
import { mockMembership, mockSession } from './tests-support.ts';

const storageModule = await import('@orbit/services/storage');

const uploads: string[] = [];

const fakeDriver = {
  name: 's3',
  createUploadTarget: (key: string, contentType: string, contentLength: number) => {
    uploads.push(key);
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

interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const signedIn: { value: { user: SessionUser; session: { activeOrganizationId: string } } | null } =
  { value: null };

const membership: { value: MembershipContext | null } = { value: null };

export function installRouteMocks(): void {
  mock.module('@orbit/services/storage', () => ({
    ...storageModule,
    storageDriver: () => fakeDriver,
  }));
  mockSession(() => signedIn.value);
  mockMembership(() => membership.value);
}

installRouteMocks();

export function uploadsRegistered(): readonly string[] {
  return uploads;
}

export function forgetUploads(): void {
  uploads.length = 0;
}

export const ISSUES_BASE = 'http://localhost:3000/api/issues';
export const PRESIGN_URL = 'http://localhost:3000/api/attachments/presign';

export function contextFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

export interface Actor {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly principal: Principal;
}

export interface IssueRef {
  readonly id: string;
  readonly identifier: string;
}

export interface IssueRoutesWorld {
  readonly workspace: Workspace;
  readonly admin: Actor;
  readonly outsider: Actor;
  readonly guest: Actor;
  readonly first: IssueRef;
  readonly second: IssueRef;
  readonly hidden: IssueRef;
  readonly openCommentId: string;
  readonly hiddenCommentId: string;
}

let organizationId = '';

export async function actorFor(user: { id: string; name: string; email: string }): Promise<Actor> {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    principal: await resolvePrincipal(user.id, organizationId),
  };
}

export function signInAs(person: Actor): void {
  signedIn.value = {
    user: { id: person.userId, name: person.name, email: person.email },
    session: { activeOrganizationId: organizationId },
  };
  membership.value = {
    principal: person.principal,
    memberId: `member_${person.userId}`,
    organizationName: 'Nova',
    organizationSlug: 'nova',
  };
}

export function signedInSnapshot(): {
  session: typeof signedIn.value;
  membership: typeof membership.value;
} {
  return { session: signedIn.value, membership: membership.value };
}

export function restoreSignIn(snapshot: ReturnType<typeof signedInSnapshot>): void {
  signedIn.value = snapshot.session;
  membership.value = snapshot.membership;
}

export async function buildIssueRoutesWorld(): Promise<IssueRoutesWorld> {
  await resetDatabase();
  const workspace = await createWorkspace('Nova');
  organizationId = workspace.organizationId;

  const admin = await actorFor(workspace.adminUser);
  const away = await addMember(workspace, 'member', { name: 'Odie Outsider', teamIds: [] });
  const outsider = await actorFor(away.user);
  const visiting = await addMember(workspace, 'guest', { name: 'Gus Guest' });
  const guest = await actorFor(visiting.user);

  const one = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Blocks the other',
  });
  const two = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Blocked by the first',
  });
  const open = await createComment(workspace.admin, one.issue.id, { body: 'Out in the open' });

  const walled = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
  const state = walled.states[0];
  if (state === undefined) throw new Error('missing state');
  const behind = await createIssue(workspace.admin, {
    teamId: walled.team.id,
    title: 'Behind the wall',
    stateId: state.id,
  });
  const secret = await createComment(workspace.admin, behind.issue.id, { body: 'Private' });

  return {
    workspace,
    admin,
    outsider,
    guest,
    first: { id: one.issue.id, identifier: one.issue.identifier },
    second: { id: two.issue.id, identifier: two.issue.identifier },
    hidden: { id: behind.issue.id, identifier: behind.issue.identifier },
    openCommentId: open.comment.id,
    hiddenCommentId: secret.comment.id,
  };
}

export const relationListSchema = z.object({
  relations: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      issue: z.object({ id: z.string(), identifier: z.string(), title: z.string() }),
    }),
  ),
});

export const issueSchema = z.object({
  issue: z.object({
    id: z.string(),
    dueDate: z.string().nullable(),
    parentId: z.string().nullable(),
  }),
});

export const errorSchema = z.object({ error: z.object({ code: z.string() }) });
