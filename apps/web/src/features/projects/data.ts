import {
  listMilestones,
  listProjects,
  listProjectUpdates,
  type ProjectProgress,
  projectProgress,
} from '@orbit/core';
import { and, count, db, eq, inArray, isNull, schema, sql } from '@orbit/db';
import type { ProjectHealth, ProjectStatus } from '@orbit/shared/constants';
import { PROJECT_HEALTHS, PROJECT_STATUSES } from '@orbit/shared/constants';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { buildProjectSeries, type ProgressPoint } from './series.ts';

export interface PersonRef {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly status: ProjectStatus;
  readonly health: ProjectHealth;
  readonly targetDate: string | null;
  readonly lead: PersonRef | null;
  readonly issueCount: number;
  readonly completedCount: number;
}

function toHealth(value: string): ProjectHealth {
  return PROJECT_HEALTHS.find((entry) => entry === value) ?? 'no_update';
}

function toStatus(value: string): ProjectStatus {
  return PROJECT_STATUSES.find((entry) => entry === value) ?? 'backlog';
}

async function loadPeople(userIds: readonly string[]): Promise<Map<string, PersonRef>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(inArray(schema.user.id, [...new Set(userIds)]));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listProjectSummaries(principal: Principal): Promise<ProjectSummary[]> {
  const projects = await listProjects(principal);
  if (projects.length === 0) return [];

  const projectIds = projects.map((project) => project.id);
  const counts = await db
    .select({
      projectId: schema.issue.projectId,
      total: count(),
      completed: sql<number>`count(*) filter (where ${schema.workflowState.category} = 'completed')`,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(and(inArray(schema.issue.projectId, projectIds), isNull(schema.issue.archivedAt)))
    .groupBy(schema.issue.projectId);

  const byProject = new Map(counts.map((row) => [row.projectId, row]));
  const people = await loadPeople(
    projects.flatMap((project) => (project.leadId === null ? [] : [project.leadId])),
  );

  return projects.map((project) => {
    const tally = byProject.get(project.id);
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      summary: project.summary,
      status: toStatus(project.status),
      health: toHealth(project.health),
      targetDate: project.targetDate,
      lead: project.leadId === null ? null : (people.get(project.leadId) ?? null),
      issueCount: Number(tally?.total ?? 0),
      completedCount: Number(tally?.completed ?? 0),
    };
  });
}

export interface MilestoneView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly targetDate: string | null;
  readonly scope: number;
  readonly completed: number;
}

export interface ProjectUpdateView {
  readonly id: string;
  readonly health: ProjectHealth;
  readonly body: string;
  readonly createdAt: string;
  readonly author: PersonRef | null;
}

export interface ProjectDetail {
  readonly summary: ProjectSummary;
  readonly description: string;
  readonly startDate: string | null;
  readonly teams: { id: string; key: string; name: string }[];
  readonly progress: ProjectProgress;
  readonly milestones: MilestoneView[];
  readonly updates: ProjectUpdateView[];
  readonly series: ProgressPoint[];
}

export async function getProjectDetail(
  principal: Principal,
  slug: string,
  now: Date = new Date(),
): Promise<ProjectDetail> {
  assertCan(principal, 'project:read');
  const [project] = await db
    .select()
    .from(schema.project)
    .where(
      and(
        eq(schema.project.organizationId, principal.organizationId),
        eq(schema.project.slug, slug),
      ),
    )
    .limit(1);
  if (project === undefined) throw notFound('That project does not exist.');

  const [progress, milestones, updates, teams, issues] = await Promise.all([
    projectProgress(principal, project.id),
    listMilestones(principal, project.id),
    listProjectUpdates(principal, project.id, 20),
    db
      .select({ id: schema.team.id, key: schema.team.key, name: schema.team.name })
      .from(schema.projectTeam)
      .innerJoin(schema.team, eq(schema.team.id, schema.projectTeam.teamId))
      .where(eq(schema.projectTeam.projectId, project.id)),
    db
      .select({ createdAt: schema.issue.createdAt, completedAt: schema.issue.completedAt })
      .from(schema.issue)
      .where(and(eq(schema.issue.projectId, project.id), isNull(schema.issue.archivedAt))),
  ]);

  const people = await loadPeople([
    ...(project.leadId === null ? [] : [project.leadId]),
    ...updates.map((update) => update.authorId),
  ]);
  const milestoneProgress = new Map(progress.milestones.map((entry) => [entry.milestoneId, entry]));

  return {
    summary: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      summary: project.summary,
      status: toStatus(project.status),
      health: toHealth(project.health),
      targetDate: project.targetDate,
      lead: project.leadId === null ? null : (people.get(project.leadId) ?? null),
      issueCount: progress.scope,
      completedCount: progress.completed,
    },
    description: project.description,
    startDate: project.startDate,
    teams,
    progress,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      description: milestone.description,
      targetDate: milestone.targetDate,
      scope: milestoneProgress.get(milestone.id)?.scope ?? 0,
      completed: milestoneProgress.get(milestone.id)?.completed ?? 0,
    })),
    updates: updates
      .map((update) => ({
        id: update.id,
        health: toHealth(update.health),
        body: update.body,
        createdAt: update.createdAt.toISOString(),
        author: people.get(update.authorId) ?? null,
      }))
      .reverse(),
    series: buildProjectSeries(issues, now),
  };
}
