import { beforeEach, describe, expect, it } from 'bun:test';
import { DomainError } from '@orbit/shared/errors';
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
  getIssueFacets,
  getIssueSummary,
  listIssues,
  updateIssue,
} from '../../src/work/issue-service.ts';
import { createProject } from '../../src/work/project-service.ts';
import { getStandupMetadata } from '../../src/work/standup-service.ts';

let workspace: Workspace;
beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Standup');
});

async function task(title: string, overrides: Record<string, unknown> = {}) {
  return (await createIssue(workspace.admin, { teamId: workspace.teamId, title, ...overrides }))
    .issue;
}

describe('workspace visibility in Standup', () => {
  it('shows other teams only in Standup while preserving detail and mutation permissions', async () => {
    const issue = await task('Cross team task', { description: 'Private description' });
    for (const role of ['guest', 'contributor', 'member'] as const) {
      const { principal } = await addMember(workspace, role, { teamIds: [] });
      expect((await listIssues(principal)).issues).toEqual([]);
      const page = await listIssues(principal, { view: 'standup', select: 'full' });
      expect(page.issues).toHaveLength(1);
      expect(page.issues[0]).toMatchObject({ id: issue.id, canOpen: false });
      expect(page.issues[0]).not.toHaveProperty('description');
      await expect(getIssue(principal, issue.id)).rejects.toBeInstanceOf(DomainError);
      await expect(updateIssue(principal, issue.id, { title: 'Changed' })).rejects.toBeInstanceOf(
        DomainError,
      );
    }
    expect((await listIssues(workspace.admin, { view: 'standup' })).issues[0]).toMatchObject({
      canOpen: true,
    });
  });

  it('keeps participant cards, roster counts and facets consistent across teams', async () => {
    const { principal: reviewer } = await addMember(workspace, 'member');
    const assigned = await task('Assigned', {
      assigneeId: workspace.admin.userId,
      reviewerIds: [reviewer.userId],
    });
    await task('Unassigned', { assigneeId: null });
    const { principal } = await addMember(workspace, 'member', { teamIds: [] });
    const filter = { view: 'standup', participantId: reviewer.userId };
    expect((await listIssues(principal, filter)).issues.map((row) => row.id)).toEqual([
      assigned.id,
    ]);
    expect(await getIssueSummary(principal, { ...filter, groupBy: 'participant' })).toMatchObject({
      total: 1,
      groupTotals: { [reviewer.userId]: 1 },
    });
    expect(await getIssueFacets(principal, filter)).toMatchObject({
      scopeTotal: 1,
      facets: { assignee: { [workspace.admin.userId]: 1 } },
    });
    expect(
      (await getIssueSummary(principal, { view: 'standup', groupBy: 'participant' })).groupTotals,
    ).toMatchObject({ [reviewer.userId]: 1, [workspace.admin.userId]: 1, none: 1 });
    expect((await getIssueSummary(principal)).total).toBe(0);
    expect((await getIssueFacets(principal)).scopeTotal).toBe(0);
  });

  it('isolates workspace rows, counts, states and project metadata', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Own project',
      teamIds: [workspace.teamId],
    });
    const own = await task('Own task', { projectId: project.id });
    const other = await createWorkspace('Other');
    await createIssue(other.admin, { teamId: other.teamId, title: 'Foreign task' });
    await createProject(other.admin, { name: 'Foreign project', teamIds: [other.teamId] });
    const { principal } = await addMember(workspace, 'member', { teamIds: [] });
    expect((await listIssues(principal, { view: 'standup' })).issues.map((row) => row.id)).toEqual([
      own.id,
    ]);
    expect((await getIssueSummary(principal, { view: 'standup' })).total).toBe(1);
    expect((await getIssueFacets(principal, { view: 'standup' })).scopeTotal).toBe(1);
    const metadata = await getStandupMetadata(principal);
    expect(metadata.states.map((state) => state.id).sort()).toEqual(
      workspace.states.map((state) => state.id).sort(),
    );
    expect(metadata.projects.map((row) => row.id)).toEqual([project.id]);
    expect(metadata.projects[0]).not.toHaveProperty('description');
  });

  it('preserves filtering and pagination without searching restricted descriptions', async () => {
    const first = await task('First', { description: 'Secret phrase' });
    const second = await task('Second');
    const archived = await task('Archived');
    await archiveIssue(workspace.admin, archived.id);
    const { principal } = await addMember(workspace, 'member', { teamIds: [] });
    const page = await listIssues(principal, { view: 'standup', limit: 1 });
    expect(page.nextCursor).not.toBeNull();
    const next = await listIssues(principal, {
      view: 'standup',
      limit: 1,
      cursor: page.nextCursor,
    });
    expect([...page.issues, ...next.issues].map((row) => row.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(next.nextCursor).toBeNull();
    expect(
      (await listIssues(principal, { view: 'standup', includeArchived: true })).issues,
    ).toHaveLength(3);
    const contentFilter = {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'condition',
          property: 'content',
          operator: 'exact',
          value: 'Secret phrase',
          negate: false,
        },
      ],
    };
    expect(
      (await listIssues(principal, { view: 'standup', filter: contentFilter })).issues,
    ).toEqual([]);
    expect(
      (await listIssues(principal, { view: 'standup', query: 'Secret phrase' })).issues,
    ).toEqual([]);
    expect(
      (await listIssues(principal, { view: 'standup', query: 'Second' })).issues.map(
        (row) => row.id,
      ),
    ).toEqual([second.id]);
  });
});
