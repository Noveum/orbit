import { beforeAll, describe, expect, it } from 'bun:test';
import { createIssue, verifyMcpAccessToken } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import {
  connect,
  createWorkspace,
  errorPayload,
  mintToken,
  resetDatabase,
} from '../src/test-helpers.ts';
import { connectHuman } from './human-client.ts';

beforeAll(resetDatabase);

describe('Phase 1 Agent write boundary', () => {
  for (const gate of ['false', 'true']) {
    it(`enforces the Agent Issue Writer gate when it is ${gate}`, async () => {
      const gates = [
        'ORBIT_AGENT_IDENTITY_READ',
        'ORBIT_AGENT_CONSENT',
        'ORBIT_AGENT_ISSUE_WRITE',
        'ORBIT_ISSUE_OUTBOX_DISPATCH',
      ] as const;
      const previous = new Map(gates.map((name) => [name, process.env[name]]));
      process.env['ORBIT_AGENT_IDENTITY_READ'] = 'true';
      process.env['ORBIT_AGENT_CONSENT'] = 'true';
      process.env['ORBIT_ISSUE_OUTBOX_DISPATCH'] = 'true';
      process.env['ORBIT_AGENT_ISSUE_WRITE'] = gate;
      const workspace = await createWorkspace(`Gate${gate}`);
      const created = await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Human issue',
      });
      const token = await mintToken(workspace.organizationId, workspace.adminUser.id);
      const identity = await verifyMcpAccessToken(token);
      await db
        .update(schema.issue)
        .set({
          assigneeId: null,
          assigneeUserId: null,
          assigneeAgentId: identity.agentIdentityId,
          ownerUserId: workspace.adminUser.id,
        })
        .where(eq(schema.issue.id, created.issue.id));
      const client = await connect(token);
      try {
        const read = await client.result('get_issue', { issue: created.issue.id });
        expect(read['issue']).toMatchObject({
          assignee: {
            type: 'agent',
            id: identity.agentIdentityId,
            name: 'Test client Agent',
            avatar: null,
            deleted: false,
          },
          assigneeId: null,
          assigneeAgentId: identity.agentIdentityId,
        });
        const me = await client.result('get_me');
        expect(me['agent']).toMatchObject({
          id: identity.agentIdentityId,
          grantId: identity.grantId,
        });
        const queue = await client.result('list_agent_issues');
        expect((queue['issues'] as { id: string }[]).map((issue) => issue.id)).toContain(
          created.issue.id,
        );
        const search = await client.result('search_issues', { assignee: 'agent' });
        expect((search['issues'] as { id: string }[]).map((issue) => issue.id)).toContain(
          created.issue.id,
        );
        const human = await connectHuman(token);
        try {
          expect(errorPayload(await human.call('list_agent_issues')).code).toBe(
            'validation_failed',
          );
          expect(errorPayload(await human.call('search_issues', { assignee: 'agent' })).code).toBe(
            'validation_failed',
          );
        } finally {
          await human.close();
        }
        const before = await db.select().from(schema.issue);
        const activityBefore = await db
          .select()
          .from(schema.issueActivity)
          .where(eq(schema.issueActivity.issueId, created.issue.id));
        const deniedCreate = await client.call('create_issue', {
          team: workspace.teamId,
          title: 'Agent issue',
        });
        const deniedUpdate = await client.call('update_issue', {
          issue: created.issue.id,
          title: 'Agent update',
        });
        const deniedCycleMove = await client.call('move_to_cycle', {
          issue: created.issue.id,
          cycle: null,
        });
        expect(deniedCreate.isError).toBe(gate === 'false' ? true : undefined);
        expect(deniedUpdate.isError).toBe(gate === 'false' ? true : undefined);
        expect(deniedCycleMove.isError).toBe(true);
        if (gate === 'false') {
          expect((await client.call('archive_issue', { issue: created.issue.id })).isError).toBe(
            true,
          );
          expect((await client.call('unarchive_issue', { issue: created.issue.id })).isError).toBe(
            true,
          );
          expect((await client.call('delete_issue', { issue: created.issue.id })).isError).toBe(
            true,
          );
          expect((await client.call('move_issue', { issue: created.issue.id })).isError).toBe(true);
          expect(
            (
              await client.call('set_relation', {
                issue: created.issue.id,
                relatedIssue: created.issue.id,
                type: 'related',
              })
            ).isError,
          ).toBe(true);
          expect(await db.select().from(schema.issue)).toEqual(before);
          expect(
            await db
              .select()
              .from(schema.issueActivity)
              .where(eq(schema.issueActivity.issueId, created.issue.id)),
          ).toEqual(activityBefore);
        } else {
          expect(await db.select().from(schema.issue)).toHaveLength(before.length + 1);
          const [updated] = await db
            .select()
            .from(schema.issue)
            .where(eq(schema.issue.id, created.issue.id));
          expect(updated?.title).toBe('Agent update');
          expect(updated?.assigneeAgentId).toBe(identity.agentIdentityId);
          const states = await db
            .select({ id: schema.workflowState.id })
            .from(schema.workflowState)
            .where(eq(schema.workflowState.teamId, workspace.teamId));
          const nextState = states.find((state) => state.id !== updated?.stateId);
          if (nextState === undefined) throw new Error('The workspace needs two issue states.');
          expect(
            (
              await client.call('move_issue', {
                issue: created.issue.id,
                state: nextState.id,
              })
            ).isError,
          ).toBe(undefined);
          const agentIssue = (deniedCreate.structuredContent as { issue: { id: string } }).issue;
          expect(
            (
              await client.call('set_relation', {
                issue: created.issue.id,
                relatedIssue: agentIssue.id,
                type: 'related',
              })
            ).isError,
          ).toBe(undefined);
          expect(
            (
              await client.call('remove_relation', {
                issue: created.issue.id,
                relatedIssue: agentIssue.id,
                type: 'related',
              })
            ).isError,
          ).toBe(undefined);
          expect((await client.call('archive_issue', { issue: created.issue.id })).isError).toBe(
            undefined,
          );
          expect((await client.call('unarchive_issue', { issue: created.issue.id })).isError).toBe(
            undefined,
          );
          expect((await client.call('delete_issue', { issue: created.issue.id })).isError).toBe(
            undefined,
          );
          expect(await db.select().from(schema.issueOutbox)).not.toHaveLength(0);
        }
      } finally {
        await client.close();
        for (const name of gates) {
          const value = previous.get(name);
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });
  }
});
