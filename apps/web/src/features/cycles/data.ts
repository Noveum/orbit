import { activeCycle, type CycleProgress, cycleProgress, upcomingCycles } from '@orbit/core';
import { and, asc, db, eq, isNull, schema } from '@orbit/db';
import type { StateCategory } from '@orbit/shared/constants';
import { STATE_CATEGORIES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';

export interface CycleIssueView {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly priority: number;
  readonly assignee: { id: string; name: string; image: string | null } | null;
}

export interface StateGroup {
  readonly stateId: string;
  readonly name: string;
  readonly category: StateCategory;
  readonly color: string;
  readonly issues: CycleIssueView[];
}

export interface AssigneeTally {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  readonly scope: number;
  readonly completed: number;
}

export interface CycleView {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly teamId: string;
  readonly teamKey: string;
  readonly teamName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly progress: CycleProgress;
  readonly groups: StateGroup[];
  readonly assignees: AssigneeTally[];
}

export interface UpcomingCycleView {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly teamKey: string;
}

function toCategory(value: string): StateCategory {
  return STATE_CATEGORIES.find((entry) => entry === value) ?? 'backlog';
}

async function loadCycleIssues(cycleId: string): Promise<{
  groups: StateGroup[];
  assignees: AssigneeTally[];
}> {
  const rows = await db
    .select({
      id: schema.issue.id,
      identifier: schema.issue.identifier,
      title: schema.issue.title,
      priority: schema.issue.priority,
      stateId: schema.workflowState.id,
      stateName: schema.workflowState.name,
      stateCategory: schema.workflowState.category,
      stateColor: schema.workflowState.color,
      statePosition: schema.workflowState.position,
      assigneeId: schema.user.id,
      assigneeName: schema.user.name,
      assigneeImage: schema.user.image,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .leftJoin(schema.user, eq(schema.user.id, schema.issue.assigneeId))
    .where(and(eq(schema.issue.cycleId, cycleId), isNull(schema.issue.archivedAt)))
    .orderBy(asc(schema.workflowState.position), asc(schema.issue.sortOrder));

  const groups = new Map<string, StateGroup>();
  const tallies = new Map<string, AssigneeTally>();

  for (const row of rows) {
    const category = toCategory(row.stateCategory);
    const group = groups.get(row.stateId) ?? {
      stateId: row.stateId,
      name: row.stateName,
      category,
      color: row.stateColor,
      issues: [],
    };
    const assignee =
      row.assigneeId === null
        ? null
        : { id: row.assigneeId, name: row.assigneeName ?? 'Someone', image: row.assigneeImage };
    group.issues.push({
      id: row.id,
      identifier: row.identifier,
      title: row.title,
      priority: row.priority,
      assignee,
    });
    groups.set(row.stateId, group);

    if (assignee !== null) {
      const tally = tallies.get(assignee.id) ?? {
        id: assignee.id,
        name: assignee.name,
        image: assignee.image,
        scope: 0,
        completed: 0,
      };
      tallies.set(assignee.id, {
        ...tally,
        scope: tally.scope + 1,
        completed: tally.completed + (category === 'completed' ? 1 : 0),
      });
    }
  }

  return {
    groups: [...groups.values()],
    assignees: [...tallies.values()].sort((left, right) => right.scope - left.scope),
  };
}

export async function getActiveCycleView(
  principal: Principal,
  team: { id: string; key: string; name: string },
  now: Date = new Date(),
): Promise<CycleView | null> {
  const cycle = await activeCycle(principal, team.id, now);
  if (cycle === undefined) return null;
  const [progress, issues] = await Promise.all([
    cycleProgress(principal, cycle.id, now),
    loadCycleIssues(cycle.id),
  ]);
  return {
    id: cycle.id,
    name: cycle.name.length === 0 ? `Cycle ${cycle.number}` : cycle.name,
    number: cycle.number,
    teamId: team.id,
    teamKey: team.key,
    teamName: team.name,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    progress,
    groups: issues.groups,
    assignees: issues.assignees,
  };
}

export async function listUpcomingCycleViews(
  principal: Principal,
  team: { id: string; key: string },
  now: Date = new Date(),
): Promise<UpcomingCycleView[]> {
  const cycles = await upcomingCycles(principal, team.id, { now, limit: 6 });
  return cycles.map((cycle) => ({
    id: cycle.id,
    name: cycle.name.length === 0 ? `Cycle ${cycle.number}` : cycle.name,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    teamKey: team.key,
  }));
}
