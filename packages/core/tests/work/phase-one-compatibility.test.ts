import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { analyticsQuerySchema, UNSET_FILTER_VALUE } from '@orbit/shared';
import type { SyncAction } from '@orbit/shared/events';
import { listActivity } from '../../src/activity/activity-service.ts';
import {
  bootstrapCycleMemberships,
  captureCycleCloseOutcomes,
} from '../../src/analytics/membership.ts';
import { loadPeopleAnalytics } from '../../src/analytics/people.ts';
import { loadProjectAnalytics } from '../../src/analytics/projects.ts';
import { loadSprintAnalytics } from '../../src/analytics/sprints.ts';
import { newId } from '../../src/internal.ts';
import { removeMember } from '../../src/org/member-service.ts';
import { removeTeamMember } from '../../src/org/team-service.ts';
import { catchUp } from '../../src/realtime/backfill.ts';
import { addMember, createWorkspace, resetDatabase, stateNamed } from '../../src/test-support.ts';
import { issueActorView } from '../../src/work/issue-actor-view.ts';
import { createIssue, getIssue, listIssues, updateIssue } from '../../src/work/issue-service.ts';
import { createProject } from '../../src/work/project-service.ts';

beforeEach(resetDatabase);

async function fixture() {
  const workspace = await createWorkspace('Compatibility');
  const person = await addMember(workspace, 'member');
  const agentId = newId();
  const clientId = newId();
  await db.insert(schema.oauthApplication).values({
    id: clientId,
    clientId,
    name: 'Client',
    redirectUrls: 'https://example.com',
    type: 'web',
  });
  await db.insert(schema.agentIdentity).values({
    id: agentId,
    clientId,
    name: 'Researcher',
    avatar: '/agent.png',
    organizationId: workspace.organizationId,
    ownerUserId: person.user.id,
    ownerNameSnapshot: person.user.name,
    clientNameSnapshot: 'Client',
  });
  return { workspace, person, agentId };
}

describe('Phase 1 compatibility', () => {
  it('F7 returns rich Agent and Human views and legacy Owner fallback', async () => {
    const { workspace, person, agentId } = await fixture();
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Agent assignment',
    });
    await db
      .update(schema.issue)
      .set({
        assigneeId: null,
        assigneeUserId: null,
        assigneeAgentId: agentId,
        ownerUserId: person.user.id,
      })
      .where(eq(schema.issue.id, issue.id));
    const read = await getIssue(workspace.admin, issue.id);
    expect(read.assignee).toEqual({
      type: 'agent',
      id: agentId,
      name: 'Researcher',
      avatar: '/agent.png',
      deleted: false,
    });
    expect(read.owner).toMatchObject({
      type: 'user',
      id: person.user.id,
      name: person.user.name,
      deleted: false,
    });
    const changed = await updateIssue(workspace.admin, issue.id, { title: 'Updated title' });
    expect(changed.actions.find((action) => action.model === 'issue')?.data['assignee']).toEqual(
      read.assignee,
    );
    const replay = await catchUp(workspace.admin, 0);
    expect(replay.actions.find((action) => action.modelId === issue.id)?.data['assignee']).toEqual(
      read.assignee,
    );
    expect(
      issueActorView({
        ...issue,
        creatorUserId: null,
        assigneeId: person.user.id,
        assigneeUserId: null,
        ownerUserId: null,
      }).owner,
    ).toMatchObject({ type: 'user', id: person.user.id });
    await db
      .update(schema.agentIdentity)
      .set({ deletedAt: new Date() })
      .where(eq(schema.agentIdentity.id, agentId));
    expect((await getIssue(workspace.admin, issue.id)).assignee).toMatchObject({
      deleted: true,
      name: 'Researcher',
    });
  });

  it('F7 normalizes legacy assignee Activity without rewriting history', async () => {
    const { workspace, person } = await fixture();
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'History',
    });
    const id = newId();
    await db.insert(schema.issueActivity).values({
      id,
      organizationId: workspace.organizationId,
      issueId: issue.id,
      actorType: 'user',
      actorId: person.user.id,
      actorName: person.user.name,
      field: 'assigneeId',
      fromValue: null,
      toValue: { id: person.user.id, name: person.user.name },
    });
    const history = await listActivity(db, workspace.admin, issue.id);
    expect(history.find((row) => row.id === id)).toMatchObject({
      field: 'assignee',
      fromValue: null,
      toValue: { type: 'user', id: person.user.id },
    });
    expect(
      (await db.select().from(schema.issueActivity).where(eq(schema.issueActivity.id, id)))[0]
        ?.field,
    ).toBe('assigneeId');
  });

  it('F8 excludes Agent assignments from both Human and Unassigned People totals', async () => {
    const { workspace, person, agentId } = await fixture();
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Agent assignment',
    });
    await db
      .update(schema.issue)
      .set({
        assigneeId: null,
        assigneeUserId: null,
        assigneeAgentId: agentId,
        ownerUserId: person.user.id,
      })
      .where(eq(schema.issue.id, issue.id));
    const result = await loadPeopleAnalytics(
      workspace.admin,
      analyticsQuerySchema.parse({ lens: 'people' }),
    );
    expect(result.people.find((row) => row.person.id === 'unassigned')).toBeUndefined();
    expect(result.people.find((row) => row.person.id === person.user.id)?.currentAssignments).toBe(
      0,
    );
  });

  it('F8 captures Agent cycle snapshots and preserves project and sprint totals', async () => {
    const { workspace, person, agentId } = await fixture();
    const { project } = await createProject(workspace.admin, {
      name: 'Project',
      teamIds: [workspace.teamId],
    });
    const [cycle] = await db
      .select()
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, workspace.organizationId));
    if (!cycle) throw new Error('Missing cycle');
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Agent',
      projectId: project.id,
      assigneeId: null,
      stateId: stateNamed(workspace, 'Todo').id,
    });
    const added = new Date(Date.now() - 86400000);
    await db
      .update(schema.cycle)
      .set({
        startsAt: new Date(added.getTime() - 86400000),
        endsAt: new Date(added.getTime() + 86400000),
        completedAt: null,
      })
      .where(eq(schema.cycle.id, cycle.id));
    await db
      .update(schema.issue)
      .set({
        assigneeAgentId: agentId,
        ownerUserId: person.user.id,
        cycleId: cycle.id,
        createdAt: new Date(added.getTime() - 1000),
      })
      .where(eq(schema.issue.id, issue.id));
    await db.transaction((tx) => bootstrapCycleMemberships(tx, [cycle.id], added));
    const [membership] = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.issueId, issue.id));
    expect(membership).toMatchObject({ assigneeIdAtAdd: null, assigneeAgentIdAtAdd: agentId });
    const projectStats = await loadProjectAnalytics(
      workspace.admin,
      analyticsQuerySchema.parse({ lens: 'projects' }),
    );
    expect(projectStats.projects.find((row) => row.id === project.id)?.scopeIssues).toBe(1);
    const sprintStats = await loadSprintAnalytics(
      workspace.admin,
      analyticsQuerySchema.parse({ lens: 'sprints' }),
      { selectedSprintId: cycle.id, now: new Date(added.getTime() + 86400000) },
    );
    expect(sprintStats.current?.summary.currentScope).toBe(1);
    await db.transaction((tx) =>
      captureCycleCloseOutcomes(tx, {
        cycle,
        rolloverCycleId: cycle.id,
        occurredAt: new Date(added.getTime() + 1000),
      }),
    );
    expect(
      (
        await db
          .select()
          .from(schema.cycleIssueOutcome)
          .where(eq(schema.cycleIssueOutcome.issueId, issue.id))
      )[0],
    ).toMatchObject({ assigneeIdAtClose: null, assigneeAgentIdAtClose: agentId });
    const filtered = await listIssues(workspace.admin, {
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'assignee',
            operator: 'in',
            values: [UNSET_FILTER_VALUE],
            negate: false,
          },
        ],
      },
    });
    expect(filtered.issues.map((row) => row.id)).not.toContain(issue.id);
  });

  for (const removal of ['workspace', 'team']) {
    it(`F9 clears open responsibility on ${removal} removal and preserves closed history`, async () => {
      const { workspace, person, agentId } = await fixture();
      const ids: string[] = [];
      for (const category of ['Todo', 'Done', 'Canceled']) {
        const stateId = stateNamed(workspace, category).id;
        const { issue } = await createIssue(workspace.admin, {
          teamId: workspace.teamId,
          title: category,
          stateId,
          assigneeId: person.user.id,
          reviewerIds: [person.user.id],
        });
        ids.push(issue.id);
      }
      const { issue: agentIssue } = await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Agent',
      });
      await db
        .update(schema.issue)
        .set({
          assigneeId: null,
          assigneeUserId: null,
          assigneeAgentId: agentId,
          ownerUserId: person.user.id,
        })
        .where(eq(schema.issue.id, agentIssue.id));
      let actions: readonly SyncAction[];
      if (removal === 'workspace') {
        const [membership] = await db
          .select()
          .from(schema.member)
          .where(eq(schema.member.userId, person.user.id));
        if (!membership) throw new Error('Missing membership');
        actions = (await removeMember(workspace.admin, membership.id)).actions;
      } else {
        actions = await removeTeamMember(workspace.admin, workspace.teamId, person.user.id);
      }
      expect(actions.find((action) => action.modelId === ids[0])?.data).toMatchObject({
        assignee: null,
        owner: null,
        reviewerIds: [],
      });
      const [open] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, ids[0] ?? ''));
      expect(open).toMatchObject({ assigneeId: null, assigneeUserId: null, ownerUserId: null });
      const [agent] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, agentIssue.id));
      expect(agent).toMatchObject({ assigneeAgentId: null, ownerUserId: null });
      for (const id of ids.slice(1)) {
        expect(
          (await db.select().from(schema.issue).where(eq(schema.issue.id, id)))[0],
        ).toMatchObject({
          assigneeId: person.user.id,
          assigneeUserId: person.user.id,
          ownerUserId: person.user.id,
        });
      }
    });
  }
});
