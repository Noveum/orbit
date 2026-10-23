import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { newId } from '../../src/internal.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import { createIssue, getIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Assignmentundo');
});

describe('canonical Human assignment undo conditions', () => {
  it.each(['undo', 'redo'] as const)(
    'rejects a stale %s after an intervening Agent assignment without changing the Issue',
    async (operation) => {
      const { issue } = await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Human assignment history',
        ...(operation === 'redo' ? { assigneeId: null } : {}),
      });
      if (operation === 'redo') {
        await updateIssue(workspace.admin, issue.id, { assigneeId: workspace.admin.userId });
      }
      await updateIssue(workspace.admin, issue.id, {
        assigneeId: null,
        ...(operation === 'redo'
          ? { expected: { assigneeId: workspace.admin.userId, assigneeAgentId: null } }
          : {}),
      });
      const agentId = newId();
      await db.insert(schema.agentIdentity).values({
        id: agentId,
        organizationId: workspace.organizationId,
        ownerUserId: workspace.admin.userId,
        name: 'Current assignee',
        ownerNameSnapshot: workspace.adminUser.name,
        clientNameSnapshot: 'Assignment history client',
      });
      await updateIssue(workspace.admin, issue.id, { assigneeAgentId: agentId });
      const before = await getIssue(workspace.admin, issue.id);
      expect(before.assigneeId).toBeNull();
      expect(before.assigneeAgentId).toBe(agentId);
      await expect(
        updateIssue(workspace.admin, issue.id, {
          assigneeId: workspace.admin.userId,
          expected: { assigneeId: null, assigneeAgentId: null },
        }),
      ).rejects.toThrow('Cannot undo: agent assignee was changed by another update.');
      const [stored] = await db.select().from(schema.issue).where(eq(schema.issue.id, issue.id));
      expect(stored).toMatchObject({
        assigneeId: null,
        assigneeUserId: null,
        assigneeAgentId: agentId,
        ownerUserId: before.ownerUserId,
        syncId: before.syncId,
        updatedAt: before.updatedAt,
      });
    },
  );

  it('allows ordinary Human assignment undo and redo when both expected references match', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Human assignment undo and redo',
    });
    await updateIssue(workspace.admin, issue.id, { assigneeId: null });
    const undone = await updateIssue(workspace.admin, issue.id, {
      assigneeId: workspace.admin.userId,
      expected: { assigneeId: null, assigneeAgentId: null },
    });
    expect(undone.issue.assigneeId).toBe(workspace.admin.userId);
    expect(undone.issue.assigneeAgentId).toBeNull();
    const redone = await updateIssue(workspace.admin, issue.id, {
      assigneeId: null,
      expected: { assigneeId: workspace.admin.userId, assigneeAgentId: null },
    });
    expect(redone.issue.assigneeId).toBeNull();
    expect(redone.issue.assigneeAgentId).toBeNull();
  });
});
