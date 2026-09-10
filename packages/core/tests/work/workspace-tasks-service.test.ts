import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema, sql } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import {
  archiveIssue,
  createIssue,
  getIssue,
  listIssues,
  updateIssue,
} from '../../src/work/issue-service.ts';
import { listWorkspaceTasks } from '../../src/work/workspace-tasks-service.ts';

let workspace: Workspace;
beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Taskview');
});
async function task(title: string, overrides: Record<string, unknown> = {}) {
  return (await createIssue(workspace.admin, { teamId: workspace.teamId, title, ...overrides }))
    .issue;
}

describe('workspace task overview', () => {
  it('shows tasks outside a member’s teams without granting detail or edit access', async () => {
    const issue = await task('Another team’s task', { description: 'Hidden description phrase' });
    const { principal } = await addMember(workspace, 'member', { teamIds: [] });
    expect((await listIssues(principal)).issues).toHaveLength(0);
    const overview = await listWorkspaceTasks(principal);
    expect(overview.tasks).toHaveLength(1);
    expect(overview.tasks[0]).toMatchObject({ id: issue.id, title: issue.title, canOpen: false });
    expect(overview.tasks[0]).not.toHaveProperty('description');
    expect(
      (await listWorkspaceTasks(principal, { query: 'Hidden description phrase' })).tasks,
    ).toEqual([]);
    await expect(getIssue(principal, issue.id)).rejects.toBeInstanceOf(DomainError);
    await expect(updateIssue(principal, issue.id, { title: 'Changed' })).rejects.toBeInstanceOf(
      DomainError,
    );
  });
  it('never includes another workspace, even when searching for its task identifier', async () => {
    const own = await task('Own workspace');
    const other = await createWorkspace('Elsewhere');
    const foreign = (
      await createIssue(other.admin, { teamId: other.teamId, title: 'Foreign task' })
    ).issue;
    expect((await listWorkspaceTasks(workspace.admin)).tasks.map((entry) => entry.id)).toEqual([
      own.id,
    ]);
    expect(
      (await listWorkspaceTasks(workspace.admin, { query: foreign.identifier })).tasks,
    ).toEqual([]);
  });
  it('allows every workspace role to read summaries and links only accessible details', async () => {
    await task('Shared summary');
    for (const role of ['guest', 'contributor', 'member'] as const) {
      const { principal } = await addMember(workspace, role, { teamIds: [] });
      expect((await listWorkspaceTasks(principal)).tasks[0]?.canOpen).toBe(false);
    }
    const { principal } = await addMember(workspace, 'member');
    expect((await listWorkspaceTasks(principal)).tasks[0]?.canOpen).toBe(true);
    expect((await listWorkspaceTasks(workspace.admin)).tasks[0]?.canOpen).toBe(true);
  });
  it('filters by search, assignee, status and archive state while including subtasks', async () => {
    const parent = await task('Parent');
    const child = await task('Unique child', { parentId: parent.id, assigneeId: null });
    await archiveIssue(workspace.admin, parent.id);
    const { principal } = await addMember(workspace, 'member', { teamIds: [] });
    const filtered = await listWorkspaceTasks(principal, {
      query: 'Unique',
      assigneeId: UNSET_FILTER_VALUE,
      stateCategory: 'triage',
    });
    expect(filtered.tasks.map((entry) => entry.id)).toEqual([child.id]);
    expect(
      (await listWorkspaceTasks(principal, { assigneeId: workspace.admin.userId })).tasks,
    ).toEqual([]);
    expect((await listWorkspaceTasks(principal, { includeArchived: true })).tasks).toHaveLength(2);
    expect((await listWorkspaceTasks(principal, { stateCategory: 'completed' })).tasks).toEqual([]);
  });
  it('paginates equal timestamps without missing or repeating tasks', async () => {
    const ids: string[] = [];
    for (const title of ['First', 'Second', 'Third']) {
      const issue = await task(title);
      ids.push(issue.id);
      await db
        .update(schema.issue)
        .set({ updatedAt: sql`'2026-09-01T00:00:00.000123Z'::timestamptz` })
        .where(eq(schema.issue.id, issue.id));
    }
    const { principal } = await addMember(workspace, 'member', { teamIds: [] });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listWorkspaceTasks(principal, {
        limit: 1,
        ...(cursor === null ? {} : { cursor }),
      });
      seen.push(...page.tasks.map((entry) => entry.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(ids.toSorted().reverse());
    expect(new Set(seen).size).toBe(3);
  });
  it('rejects malformed cursors and invalid filters', async () => {
    for (const cursor of [
      'bad',
      Buffer.from(JSON.stringify(['not-a-date', 'not-an-id'])).toString('base64url'),
    ]) {
      await expect(listWorkspaceTasks(workspace.admin, { cursor })).rejects.toBeInstanceOf(
        DomainError,
      );
    }
    await expect(listWorkspaceTasks(workspace.admin, { limit: 201 })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(
      listWorkspaceTasks(workspace.admin, { stateCategory: 'invalid' }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
