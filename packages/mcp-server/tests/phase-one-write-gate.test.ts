import { beforeAll, describe, expect, it } from 'bun:test';
import { createIssue, verifyMcpAccessToken } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import { connect, createWorkspace, mintToken, resetDatabase } from '../src/test-helpers.ts';

beforeAll(resetDatabase);

describe('Phase 1 Agent write boundary', () => {
  for (const gate of ['false', 'true']) {
    it(`refuses bound Agent issue writes without Human fallback when the gate is ${gate}`, async () => {
      const previous = process.env['ORBIT_AGENT_ISSUE_WRITE'];
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
        const deniedArchive = await client.call('archive_issue', { issue: created.issue.id });
        const deniedUnarchive = await client.call('unarchive_issue', { issue: created.issue.id });
        const deniedDelete = await client.call('delete_issue', { issue: created.issue.id });
        const deniedCycleMove = await client.call('move_to_cycle', {
          issue: created.issue.id,
          cycle: null,
        });
        expect(deniedCreate.isError).toBe(true);
        expect(deniedUpdate.isError).toBe(true);
        expect(deniedArchive.isError).toBe(true);
        expect(deniedUnarchive.isError).toBe(true);
        expect(deniedDelete.isError).toBe(true);
        expect(deniedCycleMove.isError).toBe(true);
        expect(await db.select().from(schema.issue)).toEqual(before);
        expect(
          await db
            .select()
            .from(schema.issueActivity)
            .where(eq(schema.issueActivity.issueId, created.issue.id)),
        ).toEqual(activityBefore);
      } finally {
        await client.close();
        if (previous === undefined) delete process.env['ORBIT_AGENT_ISSUE_WRITE'];
        else process.env['ORBIT_AGENT_ISSUE_WRITE'] = previous;
      }
    });
  }
});
