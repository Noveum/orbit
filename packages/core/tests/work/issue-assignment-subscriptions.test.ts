import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, db, eq, schema } from '@orbit/db';
import { bindAgentMcpCredential, verifyMcpAccessToken } from '../../src/auth/mcp-token.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import {
  type AgentIssueWriteContext,
  agentIssueWriteContext,
} from '../../src/work/agent-issue-context.ts';
import {
  bulkUpdateIssues,
  createIssue,
  createSubIssues,
  getIssue,
  moveIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';

const secret = 'issue-assignment-subscriptions-test-secret';
const originalEnvironment = {
  mcp: process.env['ORBIT_AGENT_MCP'],
  write: process.env['ORBIT_AGENT_ISSUE_WRITE'],
  secret: process.env['BETTER_AUTH_SECRET'],
};
let workspace: Workspace;
let owner: Awaited<ReturnType<typeof addMember>>;
let context: AgentIssueWriteContext;

async function verifiedAgentContext(): Promise<AgentIssueWriteContext> {
  const clientId = randomUUID();
  const identityId = randomUUID();
  const grantId = randomUUID();
  const accessToken = randomUUID();
  const [membership] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspace.organizationId),
        eq(schema.member.userId, owner.user.id),
      ),
    );
  if (membership === undefined) throw new Error('Missing owner membership.');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Subscription client',
    redirectUrls: 'https://example.test/callback',
    type: 'public',
  });
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: workspace.organizationId,
    ownerUserId: owner.user.id,
    clientId,
    name: 'Assigned Agent',
    ownerNameSnapshot: owner.user.name,
    clientNameSnapshot: 'Subscription client',
  });
  await db.insert(schema.mcpGrant).values({
    id: grantId,
    clientId,
    userId: owner.user.id,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read orbit.write',
    identityKind: 'agent',
    agentIdentityId: identityId,
    ownerMemberId: membership.id,
  });
  await db.insert(schema.oauthAccessToken).values({
    id: randomUUID(),
    accessToken,
    refreshToken: randomUUID(),
    clientId,
    userId: owner.user.id,
    scopes: 'orbit.read orbit.write',
    mcpGrantId: grantId,
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    refreshTokenExpiresAt: new Date(Date.now() + 120_000),
  });
  return agentIssueWriteContext(
    await verifyMcpAccessToken(bindAgentMcpCredential(accessToken, grantId, secret)),
  );
}

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'true';
  process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
  process.env['BETTER_AUTH_SECRET'] = secret;
  await resetDatabase();
  workspace = await createWorkspace('Assignmentsubscriptions');
  owner = await addMember(workspace, 'member', { name: 'Agent Owner' });
  context = await verifiedAgentContext();
});

afterEach(() => {
  for (const [key, value] of [
    ['ORBIT_AGENT_MCP', originalEnvironment.mcp],
    ['ORBIT_AGENT_ISSUE_WRITE', originalEnvironment.write],
    ['BETTER_AUTH_SECRET', originalEnvironment.secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function subscriptions(issueId: string) {
  return await db
    .select()
    .from(schema.issueSubscription)
    .where(eq(schema.issueSubscription.issueId, issueId));
}

async function ownerNotifications(issueId: string) {
  return await db
    .select()
    .from(schema.notification)
    .where(
      and(eq(schema.notification.entityId, issueId), eq(schema.notification.userId, owner.user.id)),
    );
}

async function advanceState(issueId: string, agent: boolean) {
  const issue = await getIssue(workspace.admin, issueId);
  const next = workspace.states.find((state) => state.id !== issue.stateId);
  if (next === undefined) throw new Error('Missing alternative state.');
  if (agent) {
    await updateIssue(owner.principal, issueId, { stateId: next.id }, db, context);
  } else {
    await updateIssue(workspace.admin, issueId, { stateId: next.id });
  }
}

describe('canonical Assignee notification subscriptions', () => {
  it.each(['update', 'bulk', 'move'] as const)(
    'subscribes the Agent Owner through %s and retains a different Issue Owner',
    async (route) => {
      const agentIssue = (
        await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Agent assignment' })
      ).issue;
      const humanIssue = (
        await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Human assignment' })
      ).issue;
      if (route === 'update') {
        await updateIssue(
          owner.principal,
          agentIssue.id,
          { assigneeAgentId: context.identityId },
          db,
          context,
        );
      } else if (route === 'bulk') {
        await bulkUpdateIssues(
          owner.principal,
          { issueIds: [agentIssue.id], patch: { assigneeAgentId: context.identityId } },
          context,
        );
      } else {
        await moveIssue(
          owner.principal,
          agentIssue.id,
          { assigneeAgentId: context.identityId },
          context,
        );
      }
      await updateIssue(workspace.admin, humanIssue.id, { assigneeId: owner.user.id });
      expect((await getIssue(workspace.admin, agentIssue.id)).ownerUserId).toBe(
        workspace.admin.userId,
      );
      expect((await ownerNotifications(agentIssue.id)).map((row) => row.type)).toEqual([
        'issue_assigned',
      ]);
      expect((await subscriptions(agentIssue.id)).map((row) => row.userId)).toContain(
        owner.user.id,
      );
      expect((await subscriptions(humanIssue.id)).map((row) => row.userId)).toContain(
        owner.user.id,
      );

      await advanceState(agentIssue.id, true);
      await advanceState(humanIssue.id, false);
      const agentNotifications = await ownerNotifications(agentIssue.id);
      expect(agentNotifications.map((row) => row.type).sort()).toEqual([
        'issue_assigned',
        'issue_status_changed',
      ]);
      expect(agentNotifications.every((row) => row.actorType === 'agent')).toBe(true);
      expect(agentNotifications.every((row) => row.actorId === context.identityId)).toBe(true);
      expect((await ownerNotifications(humanIssue.id)).map((row) => row.type).sort()).toEqual([
        'issue_assigned',
        'issue_status_changed',
      ]);
    },
  );

  it.each(['create', 'sub-issue'] as const)(
    'subscribes the Agent Owner on %s and keeps Agent self-notifications',
    async (route) => {
      let issueId: string;
      if (route === 'create') {
        issueId = (
          await createIssue(
            owner.principal,
            {
              teamId: workspace.teamId,
              title: 'Agent created',
              assigneeAgentId: context.identityId,
            },
            context,
          )
        ).issue.id;
      } else {
        const parent = (
          await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Parent' })
        ).issue;
        const children = await createSubIssues(
          owner.principal,
          {
            parentId: parent.id,
            issues: [{ title: 'Agent child', assigneeAgentId: context.identityId }],
          },
          context,
        );
        const child = children.issues[0];
        if (child === undefined) throw new Error('Missing child Issue.');
        issueId = child.id;
      }
      expect((await subscriptions(issueId)).map((row) => row.userId)).toEqual([owner.user.id]);
      expect((await getIssue(workspace.admin, issueId)).ownerUserId).toBe(owner.user.id);
      await advanceState(issueId, true);
      expect((await ownerNotifications(issueId)).map((row) => row.type).sort()).toEqual([
        'issue_assigned',
        'issue_status_changed',
      ]);
    },
  );

  it('keeps existing subscriptions after an Agent assignment is removed or replaced', async () => {
    const issue = (
      await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Reassigned' })
    ).issue;
    const next = await addMember(workspace, 'member', { name: 'Next Assignee' });
    await updateIssue(
      owner.principal,
      issue.id,
      { assigneeAgentId: context.identityId },
      db,
      context,
    );
    await updateIssue(owner.principal, issue.id, { assigneeId: null }, db, context);
    await updateIssue(workspace.admin, issue.id, { assigneeId: next.user.id });
    const subscribedIds = (await subscriptions(issue.id)).map((row) => row.userId);
    expect(subscribedIds.sort()).toEqual(
      [workspace.admin.userId, owner.user.id, next.user.id].sort(),
    );
    await advanceState(issue.id, false);
    expect((await ownerNotifications(issue.id)).map((row) => row.type).sort()).toEqual([
      'issue_assigned',
      'issue_status_changed',
    ]);
  });

  it('preserves Human self-notification suppression while retaining their subscription', async () => {
    const issue = (
      await createIssue(owner.principal, { teamId: workspace.teamId, title: 'Human self' })
    ).issue;
    const state = workspace.states.find((candidate) => candidate.id !== issue.stateId);
    if (state === undefined) throw new Error('Missing alternative state.');
    await updateIssue(owner.principal, issue.id, { stateId: state.id });
    expect((await subscriptions(issue.id)).map((row) => row.userId)).toEqual([owner.user.id]);
    expect(await ownerNotifications(issue.id)).toEqual([]);
  });
});
