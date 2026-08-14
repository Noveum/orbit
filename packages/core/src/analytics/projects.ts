import { and, asc, db, eq, isNull, not, or, schema, sql } from '@orbit/db';
import {
  PROJECT_HEALTHS,
  PROJECT_STATUSES,
  type ProjectHealth,
  type ProjectStatus,
} from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';
import { baseAnalyticsPredicate, resolveOverviewQuery } from './drilldown.ts';
import { bucketDates, calendarDateLabel } from './filter.ts';
import type { AnalyticsCoverage } from './types.ts';

export const PROJECT_ANALYTICS_LIMIT = 100;
export const PROJECT_MILESTONE_LIMIT = 200;
const PROJECT_TEAM_LIMIT = 50;
const PROJECT_UPDATE_LIMIT = 20;
const STALE_DAYS = 14;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProjectAnalyticsContext {
  readonly now?: Date;
  readonly timezone?: string;
}

export interface ProjectTeamRef {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export type EstimateCoverage = 'none' | 'mixed' | 'complete';
export type ProjectEntryCoverage = 'captured' | 'current_project' | 'mixed';

export interface ProjectRiskCohorts {
  readonly current: AnalyticsDrilldownCohort;
  readonly open: AnalyticsDrilldownCohort;
  readonly completed: AnalyticsDrilldownCohort;
  readonly blocked: AnalyticsDrilldownCohort;
  readonly overdue: AnalyticsDrilldownCohort;
  readonly stale: AnalyticsDrilldownCohort;
  readonly unestimated: AnalyticsDrilldownCohort;
  readonly scopeAdded: AnalyticsDrilldownCohort;
  readonly completedInRange: AnalyticsDrilldownCohort;
}

export interface ProjectAnalyticsRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: ProjectStatus;
  readonly health: ProjectHealth;
  readonly healthSource: 'manual';
  readonly archived: boolean;
  readonly lead: { readonly id: string; readonly name: string } | null;
  readonly teams: readonly ProjectTeamRef[];
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly scopeIssues: number;
  readonly scopePoints: number;
  readonly openIssues: number;
  readonly openPoints: number;
  readonly wipIssues: number;
  readonly wipPoints: number;
  readonly completedIssues: number;
  readonly completedPoints: number;
  readonly blocked: number;
  readonly overdue: number;
  readonly stale: number;
  readonly unestimated: number;
  readonly scopeAddedIssues: number;
  readonly scopeAddedPoints: number;
  readonly scopeAddedCoverage: ProjectEntryCoverage;
  readonly completedInRangeIssues: number;
  readonly completedInRangePoints: number;
  readonly estimateCoverage: EstimateCoverage;
  readonly nextMilestoneId: string | null;
  readonly nextMilestoneName: string | null;
  readonly nextMilestoneTargetDate: string | null;
  readonly cohorts: ProjectRiskCohorts;
}

export interface ProjectDeliveryPoint {
  readonly date: string;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly open: number;
  readonly added: number;
  readonly completedInBucket: number;
  readonly scopeCohort: AnalyticsDrilldownCohort;
  readonly startedCohort: AnalyticsDrilldownCohort;
  readonly completedCohort: AnalyticsDrilldownCohort;
  readonly openCohort: AnalyticsDrilldownCohort;
  readonly addedCohort: AnalyticsDrilldownCohort;
  readonly completedInBucketCohort: AnalyticsDrilldownCohort;
}

export interface ProjectMilestoneAnalyticsRow {
  readonly id: string;
  readonly name: string;
  readonly targetDate: string | null;
  readonly scopeIssues: number;
  readonly scopePoints: number;
  readonly completedIssues: number;
  readonly completedPoints: number;
  readonly progressIssues: number | null;
  readonly progressPoints: number | null;
  readonly currentCohort: AnalyticsDrilldownCohort;
  readonly completedCohort: AnalyticsDrilldownCohort;
}

export interface ProjectHealthUpdate {
  readonly id: string;
  readonly health: ProjectHealth;
  readonly body: string;
  readonly createdAt: string;
  readonly author: { readonly id: string; readonly name: string };
}

export interface FocusedProjectAnalytics {
  readonly project: ProjectAnalyticsRow;
  readonly delivery: readonly ProjectDeliveryPoint[];
  readonly milestones: readonly ProjectMilestoneAnalyticsRow[];
  readonly totalMilestones: number;
  readonly milestonesTruncated: boolean;
  readonly healthUpdates: readonly ProjectHealthUpdate[];
}

export interface ProjectAnalytics {
  readonly lens: 'projects';
  readonly asOf: string;
  readonly projects: readonly ProjectAnalyticsRow[];
  readonly totalProjects: number;
  readonly truncated: boolean;
  readonly focused: FocusedProjectAnalytics | null;
  readonly coverage: AnalyticsCoverage;
}

interface ProjectBaseRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly health: string;
  readonly archivedAt: Date | null;
  readonly leadId: string | null;
  readonly leadName: string | null;
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly totalProjects: number;
}

interface ProjectStatRow {
  readonly [key: string]: unknown;
  readonly project_id: string;
  readonly scope_issues: number | string;
  readonly scope_points: number | string;
  readonly open_issues: number | string;
  readonly open_points: number | string;
  readonly wip_issues: number | string;
  readonly wip_points: number | string;
  readonly completed_issues: number | string;
  readonly completed_points: number | string;
  readonly blocked: number | string;
  readonly overdue: number | string;
  readonly stale: number | string;
  readonly unestimated: number | string;
  readonly estimated: number | string;
  readonly completed_range_issues: number | string;
  readonly completed_range_points: number | string;
}

interface ProjectAddedRow {
  readonly [key: string]: unknown;
  readonly project_id: string;
  readonly scope_added_issues: number | string;
  readonly scope_added_points: number | string;
  readonly current_project_entries: number | string;
}

interface NextMilestoneRow {
  readonly [key: string]: unknown;
  readonly project_id: string;
  readonly id: string;
  readonly name: string;
  readonly target_date: string | null;
}

interface DeliveryRow {
  readonly [key: string]: unknown;
  readonly date: string;
  readonly scope: number | string;
  readonly started: number | string;
  readonly completed: number | string;
  readonly open: number | string;
  readonly added: number | string;
  readonly completed_in_bucket: number | string;
}

interface MilestoneRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly target_date: string | null;
  readonly scope_issues: number | string;
  readonly scope_points: number | string;
  readonly completed_issues: number | string;
  readonly completed_points: number | string;
  readonly total_milestones: number | string;
}

type AnalyticsFilterNode = AnalyticsQuery['filter']['children'][number];
interface PlanningSelection {
  readonly matches: SQL<unknown>;
  readonly anchored: SQL<unknown>;
}

function validProjectHealth(value: string): ProjectHealth {
  return PROJECT_HEALTHS.find((entry) => entry === value) ?? 'no_update';
}

function validProjectStatus(value: string): ProjectStatus {
  return PROJECT_STATUSES.find((entry) => entry === value) ?? 'backlog';
}

function combineSelection(
  node: Extract<AnalyticsFilterNode, { readonly kind: 'group' }>,
  selections: readonly PlanningSelection[],
): PlanningSelection {
  const combine = node.combinator === 'or' ? or : and;
  const matches = combine(...selections.map((selection) => selection.matches)) ?? sql`false`;
  const anchored = or(...selections.map((selection) => selection.anchored)) ?? sql`false`;
  return { matches, anchored };
}

function planningSelection(
  node: AnalyticsFilterNode,
  projectId: SQL<unknown>,
  milestoneId?: SQL<unknown>,
): PlanningSelection {
  if (node.kind === 'group') {
    return combineSelection(
      node,
      node.children.map((child) => planningSelection(child, projectId, milestoneId)),
    );
  }
  if (node.operator !== 'in') return { matches: sql`false`, anchored: sql`false` };
  const ids = node.values.filter((value) => UUID_PATTERN.test(value));
  if (ids.length === 0) return { matches: sql`false`, anchored: sql`false` };
  let positive: SQL<unknown> | undefined;
  if (node.property === 'project') positive = sql`${projectId} in ${ids}`;
  if (node.property === 'milestone') {
    positive =
      milestoneId === undefined
        ? sql`exists (
            select 1 from milestone planning_milestone
            where planning_milestone.project_id = ${projectId}
              and planning_milestone.id in ${ids}
          )`
        : sql`${milestoneId} in ${ids}`;
  }
  if (positive === undefined) return { matches: sql`false`, anchored: sql`false` };
  return {
    matches: node.negate ? not(positive) : positive,
    anchored: node.negate ? sql`false` : positive,
  };
}

function explicitSelection(selection: PlanningSelection): SQL<unknown> {
  return and(selection.matches, selection.anchored) ?? sql`false`;
}

function containsMilestoneCondition(node: AnalyticsFilterNode): boolean {
  if (node.kind === 'condition') return node.property === 'milestone';
  return node.children.some(containsMilestoneCondition);
}

async function projectRows(
  principal: Principal,
  query: AnalyticsQuery,
  base: SQL<unknown>,
): Promise<readonly ProjectBaseRow[]> {
  const selection = planningSelection(query.filter, sql`${schema.project.id}`);
  const explicit = explicitSelection(selection);
  const issueMatch = sql`exists (
    select 1 from issue
    join workflow_state on workflow_state.id = issue.state_id
    where ${base} and issue.project_id = ${schema.project.id}
  )`;
  const eligibility =
    query.filter.children.length === 0 ? sql`true` : (or(issueMatch, explicit) ?? sql`false`);
  const filters: SQL<unknown>[] = [
    eq(schema.project.organizationId, principal.organizationId),
    eligibility,
  ];
  if (!query.includeArchived) filters.push(isNull(schema.project.archivedAt));
  if (!query.includeCanceled) filters.push(sql`${schema.project.status} <> 'canceled'`);
  return await db
    .select({
      id: schema.project.id,
      name: schema.project.name,
      slug: schema.project.slug,
      status: schema.project.status,
      health: schema.project.health,
      archivedAt: schema.project.archivedAt,
      leadId: schema.project.leadId,
      leadName: schema.user.name,
      startDate: schema.project.startDate,
      targetDate: schema.project.targetDate,
      totalProjects: sql<number>`count(*) over ()`,
    })
    .from(schema.project)
    .leftJoin(schema.user, eq(schema.user.id, schema.project.leadId))
    .where(and(...filters))
    .orderBy(sql`lower(${schema.project.name})`, asc(schema.project.id))
    .limit(PROJECT_ANALYTICS_LIMIT);
}

async function teamsByProject(
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, readonly ProjectTeamRef[]>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db.execute<{
    readonly project_id: string;
    readonly id: string;
    readonly key: string;
    readonly name: string;
  }>(sql`
    select project_id, id, key, name from (
      select project_team.project_id, team.id, team.key, team.name,
        row_number() over (
          partition by project_team.project_id order by lower(team.name), team.id
        ) as rank
      from project_team
      join team on team.id = project_team.team_id
      where project_team.project_id in ${projectIds}
    ) ranked where rank <= ${PROJECT_TEAM_LIMIT}
    order by project_id, lower(name), id
  `);
  const grouped = new Map<string, ProjectTeamRef[]>();
  for (const row of rows) {
    const list = grouped.get(row.project_id) ?? [];
    list.push({ id: row.id, key: row.key, name: row.name });
    grouped.set(row.project_id, list);
  }
  return grouped;
}

async function projectStats(
  projectIds: readonly string[],
  base: SQL<unknown>,
  asOf: Date,
  timezone: string,
  from: Date,
  to: Date,
): Promise<ReadonlyMap<string, ProjectStatRow>> {
  if (projectIds.length === 0) return new Map();
  const open = sql`workflow_state.category not in ('completed', 'canceled')`;
  const wip = sql`workflow_state.category in ('started', 'review')`;
  const completed = sql`workflow_state.category = 'completed'`;
  const blocked = sql`${open} and exists (
    select 1 from issue_relation risk_relation
    where risk_relation.issue_id = issue.id and risk_relation.type = 'blocked_by'
  )`;
  const overdue = sql`${open} and issue.due_date is not null
    and issue.due_date < (${asOf.toISOString()}::timestamptz at time zone ${timezone})::date`;
  const staleBefore = new Date(asOf.getTime() - STALE_DAYS * 86_400_000).toISOString();
  const rows = await db.execute<ProjectStatRow>(sql`
    select issue.project_id,
      count(*) as scope_issues,
      coalesce(sum(coalesce(issue.estimate, 0)), 0) as scope_points,
      count(*) filter (where ${open}) as open_issues,
      coalesce(sum(coalesce(issue.estimate, 0)) filter (where ${open}), 0) as open_points,
      count(*) filter (where ${wip}) as wip_issues,
      coalesce(sum(coalesce(issue.estimate, 0)) filter (where ${wip}), 0) as wip_points,
      count(*) filter (where ${completed}) as completed_issues,
      coalesce(sum(coalesce(issue.estimate, 0)) filter (where ${completed}), 0) as completed_points,
      count(*) filter (where ${blocked}) as blocked,
      count(*) filter (where ${overdue}) as overdue,
      count(*) filter (where ${open} and issue.updated_at < ${staleBefore}::timestamptz) as stale,
      count(*) filter (where ${open} and issue.estimate is null) as unestimated,
      count(*) filter (where issue.estimate is not null) as estimated,
      count(*) filter (
        where issue.completed_at >= ${from.toISOString()}::timestamptz
          and issue.completed_at < ${to.toISOString()}::timestamptz
      ) as completed_range_issues,
      coalesce(sum(coalesce(issue.estimate, 0)) filter (
        where issue.completed_at >= ${from.toISOString()}::timestamptz
          and issue.completed_at < ${to.toISOString()}::timestamptz
      ), 0) as completed_range_points
    from issue
    join workflow_state on workflow_state.id = issue.state_id
    where ${base} and issue.project_id in ${projectIds}
    group by issue.project_id
  `);
  return new Map(rows.map((row) => [row.project_id, row]));
}

async function projectAddedStats(
  projectIds: readonly string[],
  base: SQL<unknown>,
  from: Date,
  to: Date,
): Promise<ReadonlyMap<string, ProjectAddedRow>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db.execute<ProjectAddedRow>(sql`
    with filtered as materialized (
      select issue.* from issue
      join workflow_state on workflow_state.id = issue.state_id
      where ${base}
    ), entries as (
      select issue.id as issue_id,
        case when exists (
          select 1 from issue_activity project_history
          where project_history.issue_id = issue.id and project_history.field = 'projectId'
        ) then (
            select coalesce(first_project.from_value ->> 'id', first_project.from_value #>> '{}')
            from issue_activity first_project
            where first_project.issue_id = issue.id and first_project.field = 'projectId'
            order by first_project.created_at, first_project.id
            limit 1
          ) else issue.project_id end as project_id,
        issue.estimate,
        not exists (
          select 1 from issue_activity project_history
          where project_history.issue_id = issue.id and project_history.field = 'projectId'
        ) as current_project_entry
      from filtered issue
      where issue.created_at >= ${from.toISOString()}::timestamptz
        and issue.created_at < ${to.toISOString()}::timestamptz
      union all
      select issue.id as issue_id,
        coalesce(project_entry.to_value ->> 'id', project_entry.to_value #>> '{}') as project_id,
        issue.estimate,
        false as current_project_entry
      from filtered issue
      join issue_activity project_entry on project_entry.issue_id = issue.id
      where project_entry.field = 'projectId'
        and project_entry.created_at >= ${from.toISOString()}::timestamptz
        and project_entry.created_at < ${to.toISOString()}::timestamptz
    ), deduplicated as (
      select project_id, issue_id, max(estimate) as estimate,
        bool_or(current_project_entry) as current_project_entry
      from entries
      where project_id in ${projectIds}
      group by project_id, issue_id
    )
    select project_id,
      count(*) as scope_added_issues,
      coalesce(sum(coalesce(estimate, 0)), 0) as scope_added_points,
      count(*) filter (where current_project_entry) as current_project_entries
    from deduplicated
    group by project_id
  `);
  return new Map(rows.map((row) => [row.project_id, row]));
}

async function nextMilestones(
  organizationId: string,
  projectIds: readonly string[],
  query: AnalyticsQuery,
  base: SQL<unknown>,
): Promise<ReadonlyMap<string, NextMilestoneRow>> {
  if (projectIds.length === 0) return new Map();
  const selection = planningSelection(
    query.filter,
    sql`${schema.milestone.projectId}`,
    sql`${schema.milestone.id}`,
  );
  const selectedPredicate = containsMilestoneCondition(query.filter)
    ? (or(
        sql`exists (
          select 1 from issue
          join workflow_state on workflow_state.id = issue.state_id
          where ${base} and issue.milestone_id = ${schema.milestone.id}
        )`,
        explicitSelection(selection),
      ) ?? sql`false`)
    : sql`true`;
  const archivePredicate = query.includeArchived ? sql`true` : sql`issue.archived_at is null`;
  const canceledPredicate = query.includeCanceled
    ? sql`true`
    : sql`workflow_state.category <> 'canceled'`;
  const rows = await db.execute<NextMilestoneRow>(sql`
    with actual as materialized (
      select issue.milestone_id, workflow_state.category
      from issue
      join workflow_state on workflow_state.id = issue.state_id
      where issue.organization_id = ${organizationId}
        and issue.project_id in ${projectIds}
        and ${archivePredicate}
        and ${canceledPredicate}
    ), milestone_progress as (
      select milestone.project_id, milestone.id, milestone.name, milestone.target_date,
        milestone.sort_order, milestone.created_at,
        count(actual.milestone_id) as scope,
        count(actual.milestone_id) filter (where actual.category = 'completed') as completed
      from milestone
      left join actual on actual.milestone_id = milestone.id
      where milestone.project_id in ${projectIds}
        and ${selectedPredicate}
      group by milestone.id
    ), ranked as (
      select milestone_progress.*,
        row_number() over (
          partition by project_id order by sort_order, created_at, id
        ) as rank
      from milestone_progress
      where scope = 0 or completed < scope
    )
    select project_id, id, name, target_date from ranked where rank = 1
    order by project_id
  `);
  return new Map(rows.map((row) => [row.project_id, row]));
}

function riskCohorts(projectId: string): ProjectRiskCohorts {
  return {
    current: { cohort: `project-current:${projectId}` },
    open: { cohort: `project-open:${projectId}` },
    completed: { cohort: `project-completed:${projectId}` },
    blocked: { cohort: `project-blocked:${projectId}` },
    overdue: { cohort: `project-overdue:${projectId}` },
    stale: { cohort: `project-stale:${projectId}` },
    unestimated: { cohort: `project-unestimated:${projectId}` },
    scopeAdded: { cohort: `project-added:${projectId}` },
    completedInRange: { cohort: `project-completed-range:${projectId}` },
  };
}

function estimateCoverage(scope: number, estimated: number): EstimateCoverage {
  if (scope === 0 || estimated === 0) return 'none';
  return estimated === scope ? 'complete' : 'mixed';
}

function emptyStat(projectId: string): ProjectStatRow {
  return {
    project_id: projectId,
    scope_issues: 0,
    scope_points: 0,
    open_issues: 0,
    open_points: 0,
    wip_issues: 0,
    wip_points: 0,
    completed_issues: 0,
    completed_points: 0,
    blocked: 0,
    overdue: 0,
    stale: 0,
    unestimated: 0,
    estimated: 0,
    completed_range_issues: 0,
    completed_range_points: 0,
  };
}

function emptyAdded(projectId: string): ProjectAddedRow {
  return {
    project_id: projectId,
    scope_added_issues: 0,
    scope_added_points: 0,
    current_project_entries: 0,
  };
}

function projectEntryCoverage(added: number, current: number): ProjectEntryCoverage {
  if (added === 0 || current === 0) return 'captured';
  return added === current ? 'current_project' : 'mixed';
}

function analyticsRow(
  project: ProjectBaseRow,
  stats: ReadonlyMap<string, ProjectStatRow>,
  addedStats: ReadonlyMap<string, ProjectAddedRow>,
  teams: ReadonlyMap<string, readonly ProjectTeamRef[]>,
  milestones: ReadonlyMap<string, NextMilestoneRow>,
): ProjectAnalyticsRow {
  const stat = stats.get(project.id) ?? emptyStat(project.id);
  const added = addedStats.get(project.id) ?? emptyAdded(project.id);
  const scopeIssues = Number(stat.scope_issues);
  const next = milestones.get(project.id);
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    status: validProjectStatus(project.status),
    health: validProjectHealth(project.health),
    healthSource: 'manual',
    archived: project.archivedAt !== null,
    lead:
      project.leadId === null || project.leadName === null
        ? null
        : { id: project.leadId, name: project.leadName },
    teams: teams.get(project.id) ?? [],
    startDate: project.startDate,
    targetDate: project.targetDate,
    scopeIssues,
    scopePoints: Number(stat.scope_points),
    openIssues: Number(stat.open_issues),
    openPoints: Number(stat.open_points),
    wipIssues: Number(stat.wip_issues),
    wipPoints: Number(stat.wip_points),
    completedIssues: Number(stat.completed_issues),
    completedPoints: Number(stat.completed_points),
    blocked: Number(stat.blocked),
    overdue: Number(stat.overdue),
    stale: Number(stat.stale),
    unestimated: Number(stat.unestimated),
    scopeAddedIssues: Number(added.scope_added_issues),
    scopeAddedPoints: Number(added.scope_added_points),
    scopeAddedCoverage: projectEntryCoverage(
      Number(added.scope_added_issues),
      Number(added.current_project_entries),
    ),
    completedInRangeIssues: Number(stat.completed_range_issues),
    completedInRangePoints: Number(stat.completed_range_points),
    estimateCoverage: estimateCoverage(scopeIssues, Number(stat.estimated)),
    nextMilestoneId: next?.id ?? null,
    nextMilestoneName: next?.name ?? null,
    nextMilestoneTargetDate: next?.target_date ?? null,
    cohorts: riskCohorts(project.id),
  };
}

async function milestoneRows(
  organizationId: string,
  projectId: string,
  query: AnalyticsQuery,
  base: SQL<unknown>,
): Promise<readonly MilestoneRow[]> {
  const selection = planningSelection(
    query.filter,
    sql`${schema.milestone.projectId}`,
    sql`${schema.milestone.id}`,
  );
  const selectedPredicate = containsMilestoneCondition(query.filter)
    ? (or(
        sql`exists (
          select 1 from issue
          join workflow_state on workflow_state.id = issue.state_id
          where ${base} and issue.milestone_id = ${schema.milestone.id}
        )`,
        explicitSelection(selection),
      ) ?? sql`false`)
    : sql`true`;
  return await db.execute<MilestoneRow>(sql`
    with filtered as materialized (
      select issue.id, issue.milestone_id, issue.estimate, workflow_state.category
      from issue
      join workflow_state on workflow_state.id = issue.state_id
      where ${base} and issue.project_id = ${projectId}
    ), milestone_progress as (
      select milestone.id, milestone.name, milestone.target_date, milestone.sort_order,
        milestone.created_at,
        count(filtered.id) as scope_issues,
        coalesce(sum(coalesce(filtered.estimate, 0)), 0) as scope_points,
        count(filtered.id) filter (where filtered.category = 'completed') as completed_issues,
        coalesce(sum(coalesce(filtered.estimate, 0)) filter (
          where filtered.category = 'completed'
        ), 0) as completed_points
      from milestone
      left join filtered on filtered.milestone_id = milestone.id
      where milestone.organization_id = ${organizationId}
        and milestone.project_id = ${projectId}
        and ${selectedPredicate ?? sql`false`}
      group by milestone.id
    )
    select *, count(*) over () as total_milestones
    from milestone_progress
    order by sort_order, created_at, id
    limit ${PROJECT_MILESTONE_LIMIT}
  `);
}

function progress(completed: number, scope: number): number | null {
  return scope === 0 ? null : (completed / scope) * 100;
}

function mapMilestone(row: MilestoneRow): ProjectMilestoneAnalyticsRow {
  const scopeIssues = Number(row.scope_issues);
  const scopePoints = Number(row.scope_points);
  const completedIssues = Number(row.completed_issues);
  const completedPoints = Number(row.completed_points);
  return {
    id: row.id,
    name: row.name,
    targetDate: row.target_date,
    scopeIssues,
    scopePoints,
    completedIssues,
    completedPoints,
    progressIssues: progress(completedIssues, scopeIssues),
    progressPoints: progress(completedPoints, scopePoints),
    currentCohort: { cohort: `milestone-current:${row.id}` },
    completedCohort: { cohort: `milestone-completed:${row.id}` },
  };
}

async function deliveryRows(
  projectId: string,
  base: SQL<unknown>,
  resolved: Awaited<ReturnType<typeof resolveOverviewQuery>>,
): Promise<readonly DeliveryRow[]> {
  const starts = bucketDates(resolved.resolvedRange, resolved.bucket);
  const values = starts.map((start, index) => {
    const end = starts[index + 1] ?? resolved.to;
    return sql`(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, ${calendarDateLabel(start, resolved.timezone)})`;
  });
  if (values.length === 0) return [];
  return await db.execute<DeliveryRow>(sql`
    with buckets(bucket_start, bucket_end, date) as (values ${sql.join(values, sql`, `)}),
    filtered as materialized (
      select issue.* from issue
      join workflow_state on workflow_state.id = issue.state_id
      where ${base}
    )
    select buckets.date,
      count(issue.id) filter (
        where issue.created_at < buckets.bucket_end
          and issue.project_id = ${projectId}
          and (issue.canceled_at is null or issue.canceled_at >= buckets.bucket_end)
      ) as scope,
      count(issue.id) filter (
        where issue.project_id = ${projectId}
          and issue.started_at is not null and issue.started_at < buckets.bucket_end
      ) as started,
      count(issue.id) filter (
        where issue.project_id = ${projectId}
          and issue.completed_at is not null and issue.completed_at < buckets.bucket_end
      ) as completed,
      count(issue.id) filter (
        where issue.created_at < buckets.bucket_end
          and issue.project_id = ${projectId}
          and (issue.completed_at is null or issue.completed_at >= buckets.bucket_end)
          and (issue.canceled_at is null or issue.canceled_at >= buckets.bucket_end)
      ) as open,
      count(issue.id) filter (
        where exists (
          select 1 from issue_activity project_entry
          where project_entry.issue_id = issue.id
            and project_entry.field = 'projectId'
            and coalesce(project_entry.to_value ->> 'id', project_entry.to_value #>> '{}') = ${projectId}
            and project_entry.created_at >= buckets.bucket_start
            and project_entry.created_at < buckets.bucket_end
        ) or (
          issue.created_at >= buckets.bucket_start
          and issue.created_at < buckets.bucket_end
          and case when exists (
            select 1 from issue_activity project_history
            where project_history.issue_id = issue.id and project_history.field = 'projectId'
          ) then (
              select coalesce(first_project.from_value ->> 'id', first_project.from_value #>> '{}')
              from issue_activity first_project
              where first_project.issue_id = issue.id and first_project.field = 'projectId'
              order by first_project.created_at, first_project.id
              limit 1
            ) else issue.project_id end = ${projectId}
        )
      ) as added,
      count(issue.id) filter (
        where issue.project_id = ${projectId}
          and issue.completed_at >= buckets.bucket_start and issue.completed_at < buckets.bucket_end
      ) as completed_in_bucket
    from buckets
    left join filtered issue on issue.created_at < buckets.bucket_end
    group by buckets.bucket_start, buckets.date
    order by buckets.bucket_start
  `);
}

function mapDelivery(projectId: string, row: DeliveryRow): ProjectDeliveryPoint {
  return {
    date: row.date,
    scope: Number(row.scope),
    started: Number(row.started),
    completed: Number(row.completed),
    open: Number(row.open),
    added: Number(row.added),
    completedInBucket: Number(row.completed_in_bucket),
    scopeCohort: { cohort: `project-delivery-scope:${projectId}`, bucket: row.date },
    startedCohort: { cohort: `project-delivery-started:${projectId}`, bucket: row.date },
    completedCohort: { cohort: `project-delivery-completed:${projectId}`, bucket: row.date },
    openCohort: { cohort: `project-delivery-open:${projectId}`, bucket: row.date },
    addedCohort: { cohort: `project-delivery-added:${projectId}`, bucket: row.date },
    completedInBucketCohort: {
      cohort: `project-delivery-completed-bucket:${projectId}`,
      bucket: row.date,
    },
  };
}

async function healthUpdates(
  principal: Principal,
  projectId: string,
): Promise<readonly ProjectHealthUpdate[]> {
  const rows = await db
    .select({
      id: schema.projectUpdate.id,
      health: schema.projectUpdate.health,
      body: schema.projectUpdate.body,
      createdAt: schema.projectUpdate.createdAt,
      authorId: schema.user.id,
      authorName: schema.user.name,
    })
    .from(schema.projectUpdate)
    .innerJoin(schema.user, eq(schema.user.id, schema.projectUpdate.authorId))
    .where(
      and(
        eq(schema.projectUpdate.organizationId, principal.organizationId),
        eq(schema.projectUpdate.projectId, projectId),
      ),
    )
    .orderBy(sql`${schema.projectUpdate.createdAt} desc`, sql`${schema.projectUpdate.id} desc`)
    .limit(PROJECT_UPDATE_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    health: validProjectHealth(row.health),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { id: row.authorId, name: row.authorName },
  }));
}

export async function loadProjectAnalytics(
  principal: Principal,
  query: AnalyticsQuery,
  context: ProjectAnalyticsContext = {},
): Promise<ProjectAnalytics> {
  const resolved = await resolveOverviewQuery(principal, query, context);
  const base = baseAnalyticsPredicate(principal, resolved);
  const baseRows = await projectRows(principal, query, base);
  const projectIds = baseRows.map((row) => row.id);
  const [teams, stats, addedStats, next] = await Promise.all([
    teamsByProject(projectIds),
    projectStats(projectIds, base, resolved.asOf, resolved.timezone, resolved.from, resolved.to),
    projectAddedStats(projectIds, base, resolved.from, resolved.to),
    nextMilestones(principal.organizationId, projectIds, query, base),
  ]);
  const projects = baseRows.map((row) => analyticsRow(row, stats, addedStats, teams, next));
  const focusId = query.focus.projectId;
  const focusedProject =
    focusId === undefined ? undefined : projects.find((project) => project.id === focusId);
  let focused: FocusedProjectAnalytics | null = null;
  if (focusedProject !== undefined) {
    const [delivery, milestoneResult, updates] = await Promise.all([
      deliveryRows(focusedProject.id, base, resolved),
      milestoneRows(principal.organizationId, focusedProject.id, query, base),
      healthUpdates(principal, focusedProject.id),
    ]);
    const totalMilestones = Number(milestoneResult[0]?.total_milestones ?? 0);
    focused = {
      project: focusedProject,
      delivery: delivery.map((row) => mapDelivery(focusedProject.id, row)),
      milestones: milestoneResult.map(mapMilestone),
      totalMilestones,
      milestonesTruncated: totalMilestones > PROJECT_MILESTONE_LIMIT,
      healthUpdates: updates,
    };
  }
  const totalProjects = Number(baseRows[0]?.totalProjects ?? 0);
  const asOf = resolved.asOf.toISOString();
  return {
    lens: 'projects',
    asOf,
    projects,
    totalProjects,
    truncated: totalProjects > PROJECT_ANALYTICS_LIMIT,
    focused,
    coverage: { kind: 'live', from: null, asOf },
  };
}
