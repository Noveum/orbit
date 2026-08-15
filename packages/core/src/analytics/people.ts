import { db, eq, schema, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';
import {
  type AnalyticsServiceContext,
  baseAnalyticsPredicate,
  resolveOverviewQuery,
} from './drilldown.ts';
import { bucketDates, calendarDateLabel } from './filter.ts';
import {
  completionAttributionKind,
  completionAttributionPerson,
  historicalPersonFilter,
  selectedAssigneeIds,
  UNASSIGNED_PERSON_ID,
} from './person-attribution.ts';
import { loadSprintAnalytics, type PersonSprintBurn, type SprintSummary } from './sprints.ts';
import type { AnalyticsCoverage, ResolvedAnalyticsQuery } from './types.ts';

export const PEOPLE_ANALYTICS_LIMIT = 100;
export const PEOPLE_FOCUS_GROUP_LIMIT = 50;
export const PEOPLE_TIMELINE_LIMIT = 120;

const DAY_MILLISECONDS = 86_400_000;
const WEEK_MILLISECONDS = 7 * DAY_MILLISECONDS;
const WEEK_SECONDS = WEEK_MILLISECONDS / 1000;
const STALE_DAYS = 14;

export interface PeopleAnalyticsContext extends AnalyticsServiceContext {
  readonly selectedSprintId?: string;
}

export type PersonStatus = 'current' | 'former' | 'deleted' | 'unassigned';
export type PersonAttributionCoverage =
  | 'captured'
  | 'reconstructed'
  | 'current_assignee'
  | 'mixed'
  | 'unavailable';

export interface AnalyticsPerson {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  readonly currentMember: boolean;
  readonly status: PersonStatus;
}

export interface PersonDistribution {
  readonly valid: number;
  readonly p50: number | null;
  readonly p85: number | null;
}

export interface PersonAttributionSummary {
  readonly captured: number;
  readonly reconstructed: number;
  readonly currentAssignee: number;
  readonly kind: PersonAttributionCoverage;
}

export interface PersonCohorts {
  readonly currentAssignments: AnalyticsDrilldownCohort;
  readonly completed: AnalyticsDrilldownCohort;
  readonly wip: AnalyticsDrilldownCohort;
  readonly blocked: AnalyticsDrilldownCohort;
  readonly overdue: AnalyticsDrilldownCohort;
  readonly stale: AnalyticsDrilldownCohort;
  readonly unestimated: AnalyticsDrilldownCohort;
}

export interface PersonAnalyticsRow {
  readonly person: AnalyticsPerson;
  readonly currentAssignments: number;
  readonly currentPoints: number;
  readonly completedIssues: number;
  readonly completedPoints: number;
  readonly activeWeeks: number;
  readonly averageThroughputIssues: number;
  readonly averageThroughputPoints: number;
  readonly cycleTime: PersonDistribution;
  readonly leadTime: PersonDistribution;
  readonly currentWip: number;
  readonly currentWipPoints: number;
  readonly wipAge: PersonDistribution;
  readonly blocked: number;
  readonly overdue: number;
  readonly stale: number;
  readonly unestimated: number;
  readonly currentProjects: number;
  readonly currentMilestones: number;
  readonly currentSprints: number;
  readonly attribution: PersonAttributionSummary;
  readonly cohorts: PersonCohorts;
}

export interface PersonWorkGroup {
  readonly id: string;
  readonly name: string;
  readonly issues: number;
  readonly points: number;
  readonly cohort: AnalyticsDrilldownCohort;
}

export interface PersonTimelinePoint {
  readonly date: string;
  readonly assignedIssues: number;
  readonly assignedPoints: number;
  readonly completedIssues: number;
  readonly completedPoints: number;
  readonly assignedCohort: AnalyticsDrilldownCohort;
  readonly completedCohort: AnalyticsDrilldownCohort;
}

export interface PersonSprintBurnSelection {
  readonly selected: SprintSummary | null;
  readonly current: PersonSprintBurn | null;
  readonly previous: PersonSprintBurn | null;
}

export interface PersonAnalyticsDetail extends PersonAnalyticsRow {
  readonly projects: readonly PersonWorkGroup[];
  readonly milestones: readonly PersonWorkGroup[];
  readonly sprints: readonly PersonWorkGroup[];
  readonly states: readonly PersonWorkGroup[];
  readonly timeline: readonly PersonTimelinePoint[];
  readonly sprintBurn: PersonSprintBurnSelection;
}

export interface PeopleFormulaMetadata {
  readonly currentAssignments: string;
  readonly completed: string;
  readonly activeWeek: string;
  readonly cycleTime: string;
  readonly leadTime: string;
  readonly wipAge: string;
  readonly attribution: string;
  readonly points: string;
}

export interface PeopleAnalytics {
  readonly lens: 'people';
  readonly asOf: string;
  readonly people: readonly PersonAnalyticsRow[];
  readonly totalPeople: number;
  readonly truncated: boolean;
  readonly focused: PersonAnalyticsDetail | null;
  readonly coverage: AnalyticsCoverage;
  readonly formulas: PeopleFormulaMetadata;
}

interface IdentityRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  readonly current_member: boolean;
  readonly user_exists: boolean;
  readonly total_people: number | string;
}

interface CurrentStatRow {
  readonly [key: string]: unknown;
  readonly person_id: string;
  readonly current_assignments: number | string;
  readonly current_points: number | string;
  readonly current_wip: number | string;
  readonly current_wip_points: number | string;
  readonly wip_age_valid: number | string;
  readonly wip_age_p50: number | string | null;
  readonly wip_age_p85: number | string | null;
  readonly blocked: number | string;
  readonly overdue: number | string;
  readonly stale: number | string;
  readonly unestimated: number | string;
  readonly current_projects: number | string;
  readonly current_milestones: number | string;
  readonly current_sprints: number | string;
}

interface CompletionStatRow {
  readonly [key: string]: unknown;
  readonly person_id: string;
  readonly completed_issues: number | string;
  readonly completed_points: number | string;
  readonly cycle_valid: number | string;
  readonly cycle_p50: number | string | null;
  readonly cycle_p85: number | string | null;
  readonly lead_valid: number | string;
  readonly lead_p50: number | string | null;
  readonly lead_p85: number | string | null;
  readonly captured: number | string;
  readonly reconstructed: number | string;
  readonly current_assignee: number | string;
}

interface ActiveWeekRow {
  readonly [key: string]: unknown;
  readonly person_id: string;
  readonly active_weeks: number | string;
}

interface GroupRow {
  readonly [key: string]: unknown;
  readonly dimension: 'project' | 'milestone' | 'sprint' | 'state';
  readonly id: string;
  readonly name: string;
  readonly issues: number | string;
  readonly points: number | string;
}

interface TimelineRow {
  readonly [key: string]: unknown;
  readonly date: string;
  readonly assigned_issues: number | string;
  readonly assigned_points: number | string;
  readonly completed_issues: number | string;
  readonly completed_points: number | string;
}

function selectedPersonId(principal: Principal, query: AnalyticsQuery): string | null {
  if (query.focus.personId !== undefined) return query.focus.personId;
  const assignees = selectedAssigneeIds(query);
  if (assignees.length === 1) return assignees[0] ?? null;
  return query.lens === 'people' ? principal.userId : null;
}

function selectedPeople(query: AnalyticsQuery): readonly string[] {
  return selectedAssigneeIds(query);
}

function identityStatus(row: IdentityRow): PersonStatus {
  if (row.id === UNASSIGNED_PERSON_ID) return 'unassigned';
  if (row.current_member) return 'current';
  return row.user_exists ? 'former' : 'deleted';
}

function identityName(row: IdentityRow, status: PersonStatus): string {
  if (status === 'unassigned') return 'Unassigned';
  return status === 'deleted' ? 'Deleted user' : row.name;
}

function identity(row: IdentityRow): AnalyticsPerson {
  const status = identityStatus(row);
  return {
    id: row.id,
    name: identityName(row, status),
    image: status === 'deleted' || status === 'unassigned' ? null : row.image,
    currentMember: row.current_member,
    status,
  };
}

function identityEvidenceName(): SQL<unknown> {
  return sql`coalesce(
    assignment_value.value ->> 'name',
    assignment_value.value #>> '{}',
    'Deleted user'
  )`;
}

async function identities(
  principal: Principal,
  selected: readonly string[],
): Promise<readonly IdentityRow[]> {
  const selectedPredicate =
    selected.length === 0 ? sql`true` : sql`identity.id in ${[...selected]}`;
  return await db.execute<IdentityRow>(sql`
    with assignment_value as (
      select issue_activity.from_value as value
      from issue_activity
      where issue_activity.organization_id = ${principal.organizationId}
        and issue_activity.field = 'assigneeId'
        and issue_activity.from_value is not null
      union all
      select issue_activity.to_value as value
      from issue_activity
      where issue_activity.organization_id = ${principal.organizationId}
        and issue_activity.field = 'assigneeId'
        and issue_activity.to_value is not null
    ), evidence as (
      select member.user_id as id, person.name, person.image, true as current_member,
        true as user_exists
      from member join "user" person on person.id = member.user_id
      where member.organization_id = ${principal.organizationId}
      union all
      select issue.assignee_id, person.name, person.image, false, person.id is not null
      from issue left join "user" person on person.id = issue.assignee_id
      where issue.organization_id = ${principal.organizationId} and issue.assignee_id is not null
      union all
      select cycle_issue_membership.assignee_id_at_add, person.name, person.image, false,
        person.id is not null
      from cycle_issue_membership
      left join "user" person on person.id = cycle_issue_membership.assignee_id_at_add
      where cycle_issue_membership.organization_id = ${principal.organizationId}
        and cycle_issue_membership.assignee_id_at_add is not null
      union all
      select cycle_issue_outcome.assignee_id_at_close, person.name, person.image, false,
        person.id is not null
      from cycle_issue_outcome
      left join "user" person on person.id = cycle_issue_outcome.assignee_id_at_close
      where cycle_issue_outcome.organization_id = ${principal.organizationId}
        and cycle_issue_outcome.assignee_id_at_close is not null
      union all
      select coalesce(assignment_value.value ->> 'id', assignment_value.value #>> '{}'),
        ${identityEvidenceName()}, null, false, person.id is not null
      from assignment_value
      left join "user" person on person.id = coalesce(
        assignment_value.value ->> 'id', assignment_value.value #>> '{}'
      )
      where coalesce(assignment_value.value ->> 'id', assignment_value.value #>> '{}') is not null
      union all
      select ${UNASSIGNED_PERSON_ID}, 'Unassigned', null, false, false
      where exists (
        select 1 from issue
        where issue.organization_id = ${principal.organizationId} and issue.assignee_id is null
      ) or exists (
        select 1 from cycle_issue_outcome
        where cycle_issue_outcome.organization_id = ${principal.organizationId}
          and cycle_issue_outcome.assignee_id_at_close is null
      ) or exists (
        select 1 from issue_activity
        where issue_activity.organization_id = ${principal.organizationId}
          and issue_activity.field = 'assigneeId'
          and (issue_activity.from_value is null or issue_activity.to_value is null)
      )
    ), identity as (
      select evidence.id,
        coalesce(max(evidence.name) filter (where evidence.user_exists), max(evidence.name)) as name,
        max(evidence.image) filter (where evidence.user_exists) as image,
        bool_or(evidence.current_member) as current_member,
        bool_or(evidence.user_exists) as user_exists
      from evidence where evidence.id is not null group by evidence.id
    ), selected as (
      select identity.*, count(*) over () as total_people
      from identity where ${selectedPredicate}
    )
    select * from selected
    order by lower(name), id
    limit ${PEOPLE_ANALYTICS_LIMIT}
  `);
}

async function focusedIdentity(
  principal: Principal,
  personId: string,
): Promise<IdentityRow | undefined> {
  const rows = await identities(principal, [personId]);
  return rows[0];
}

function personIdSql(): SQL<unknown> {
  return sql`coalesce(${schema.issue.assigneeId}, ${UNASSIGNED_PERSON_ID})`;
}

async function currentStats(
  base: SQL<unknown>,
  resolved: ResolvedAnalyticsQuery,
): Promise<ReadonlyMap<string, CurrentStatRow>> {
  const open = sql`${schema.workflowState.category} not in ('completed', 'canceled')`;
  const wip = sql`${schema.workflowState.category} in ('started', 'review')`;
  const overdue = sql`${open} and ${schema.issue.dueDate} is not null
    and ${schema.issue.dueDate} < (${resolved.asOf.toISOString()}::timestamptz at time zone ${resolved.timezone})::date`;
  const staleBefore = new Date(resolved.asOf.getTime() - STALE_DAYS * DAY_MILLISECONDS);
  const rows = await db.execute<CurrentStatRow>(sql`
    select ${personIdSql()} as person_id,
      count(*) filter (where ${open}) as current_assignments,
      coalesce(sum(coalesce(issue.estimate, 1)) filter (where ${open}), 0) as current_points,
      count(*) filter (where ${wip}) as current_wip,
      coalesce(sum(coalesce(issue.estimate, 1)) filter (where ${wip}), 0) as current_wip_points,
      count(*) filter (where ${wip} and issue.state_entered_at <= ${resolved.asOf.toISOString()}::timestamptz) as wip_age_valid,
      percentile_cont(0.5) within group (
        order by extract(epoch from (${resolved.asOf.toISOString()}::timestamptz - issue.state_entered_at)) / 86400
      ) filter (where ${wip} and issue.state_entered_at <= ${resolved.asOf.toISOString()}::timestamptz) as wip_age_p50,
      percentile_cont(0.85) within group (
        order by extract(epoch from (${resolved.asOf.toISOString()}::timestamptz - issue.state_entered_at)) / 86400
      ) filter (where ${wip} and issue.state_entered_at <= ${resolved.asOf.toISOString()}::timestamptz) as wip_age_p85,
      count(*) filter (where ${open} and exists (
        select 1 from issue_relation person_blocked
        where person_blocked.issue_id = issue.id and person_blocked.type = 'blocked_by'
      )) as blocked,
      count(*) filter (where ${overdue}) as overdue,
      count(*) filter (where ${open} and issue.updated_at < ${staleBefore.toISOString()}::timestamptz) as stale,
      count(*) filter (where ${open} and issue.estimate is null) as unestimated,
      count(distinct issue.project_id) filter (where ${open}) as current_projects,
      count(distinct issue.milestone_id) filter (where ${open}) as current_milestones,
      count(distinct issue.cycle_id) filter (where ${open}) as current_sprints
    from issue join workflow_state on workflow_state.id = issue.state_id
    where ${base}
    group by issue.assignee_id
  `);
  return new Map(rows.map((row) => [row.person_id, row]));
}

function completedInterval(resolved: ResolvedAnalyticsQuery): SQL<unknown> {
  return sql`${schema.issue.completedAt} >= ${resolved.from.toISOString()}::timestamptz
    and ${schema.issue.completedAt} < ${resolved.to.toISOString()}::timestamptz`;
}

function peopleHistoricalPredicate(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  person: SQL<unknown>,
  personIds: readonly string[],
): SQL<unknown> {
  if (personIds.length === 0) return sql`false`;
  const branches = personIds.map((personId) => {
    const historical = historicalPersonFilter(resolved, personId);
    const predicate = baseAnalyticsPredicate(principal, historical.query);
    return sql`when ${personId} then (${predicate} and ${historical.matches})`;
  });
  return sql`case ${person} ${sql.join(branches, sql` `)} else false end`;
}

async function completionStats(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, CompletionStatRow>> {
  const person = completionAttributionPerson();
  const kind = completionAttributionKind();
  const personId = sql`coalesce(${person}, ${UNASSIGNED_PERSON_ID})`;
  const historical = peopleHistoricalPredicate(principal, resolved, personId, personIds);
  const rows = await db.execute<CompletionStatRow>(sql`
    with attributed as materialized (
      select issue.*, ${personId} as person_id,
        ${kind} as attribution_kind
      from issue join workflow_state on workflow_state.id = issue.state_id
      where ${historical} and issue.completed_at is not null and ${completedInterval(resolved)}
    )
    select person_id,
      count(*) as completed_issues,
      coalesce(sum(coalesce(estimate, 1)), 0) as completed_points,
      count(*) filter (where started_at is not null and completed_at >= started_at) as cycle_valid,
      percentile_cont(0.5) within group (
        order by extract(epoch from (completed_at - started_at)) / 86400
      ) filter (where started_at is not null and completed_at >= started_at) as cycle_p50,
      percentile_cont(0.85) within group (
        order by extract(epoch from (completed_at - started_at)) / 86400
      ) filter (where started_at is not null and completed_at >= started_at) as cycle_p85,
      count(*) filter (where completed_at >= created_at) as lead_valid,
      percentile_cont(0.5) within group (
        order by extract(epoch from (completed_at - created_at)) / 86400
      ) filter (where completed_at >= created_at) as lead_p50,
      percentile_cont(0.85) within group (
        order by extract(epoch from (completed_at - created_at)) / 86400
      ) filter (where completed_at >= created_at) as lead_p85,
      count(*) filter (where attribution_kind = 'captured') as captured,
      count(*) filter (where attribution_kind = 'reconstructed') as reconstructed,
      count(*) filter (where attribution_kind = 'current_assignee') as current_assignee
    from attributed group by person_id
  `);
  return new Map(rows.map((row) => [row.person_id, row]));
}

async function activeWeeks(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const person = completionAttributionPerson();
  const lastTimestamp = Math.min(resolved.to.getTime(), resolved.asOf.getTime());
  if (lastTimestamp <= resolved.from.getTime()) return new Map();
  const bucketCount = Math.max(
    1,
    Math.ceil((lastTimestamp - resolved.from.getTime()) / WEEK_MILLISECONDS),
  );
  const rows = await db.execute<ActiveWeekRow>(sql`
    with assignment_change as (
      select issue.id as issue_id, issue.created_at as issue_created_at,
        least(
          ${new Date(lastTimestamp).toISOString()}::timestamptz,
          issue.completed_at,
          issue.canceled_at,
          issue.archived_at
        ) as terminal_at,
        coalesce(
          assignment_event.from_value ->> 'id',
          assignment_event.from_value #>> '{}',
          ${UNASSIGNED_PERSON_ID}
        ) as from_person_id,
        coalesce(
          assignment_event.to_value ->> 'id',
          assignment_event.to_value #>> '{}',
          ${UNASSIGNED_PERSON_ID}
        ) as to_person_id,
        assignment_event.created_at as changed_at,
        lead(assignment_event.created_at) over (
          partition by issue.id order by assignment_event.created_at, assignment_event.id
        ) as next_change_at,
        row_number() over (
          partition by issue.id order by assignment_event.created_at, assignment_event.id
        ) as change_number
      from issue
      join issue_activity assignment_event on assignment_event.issue_id = issue.id
        and assignment_event.field = 'assigneeId'
      where issue.organization_id = ${principal.organizationId}
    ), assignment_episode_raw as (
      select assignment_change.issue_id, assignment_change.from_person_id as person_id,
        assignment_change.issue_created_at as active_from,
        least(assignment_change.changed_at, assignment_change.terminal_at) as active_to
      from assignment_change
      where assignment_change.change_number = 1
      union all
      select assignment_change.issue_id, assignment_change.to_person_id as person_id,
        assignment_change.changed_at as active_from,
        least(
          coalesce(assignment_change.next_change_at, ${new Date(lastTimestamp).toISOString()}::timestamptz),
          assignment_change.terminal_at
        ) as active_to
      from assignment_change
      union all
      select issue.id as issue_id,
        coalesce(issue.assignee_id, ${UNASSIGNED_PERSON_ID}) as person_id,
        issue.created_at as active_from,
        least(
          ${new Date(lastTimestamp).toISOString()}::timestamptz,
          issue.completed_at,
          issue.canceled_at,
          issue.archived_at
        ) as active_to
      from issue
      where issue.organization_id = ${principal.organizationId} and not exists (
        select 1 from issue_activity no_assignment_history
        where no_assignment_history.issue_id = issue.id
          and no_assignment_history.field = 'assigneeId'
      )
    ), assignment_episode as (
      select assignment_episode_raw.person_id, assignment_episode_raw.active_from,
        assignment_episode_raw.active_to
      from assignment_episode_raw
      join issue on issue.id = assignment_episode_raw.issue_id
      join workflow_state on workflow_state.id = issue.state_id
      where ${peopleHistoricalPredicate(
        principal,
        resolved,
        sql`assignment_episode_raw.person_id`,
        personIds,
      )}
    ), assignment_bucket as (
      select assignment_episode.person_id, generate_series(
        greatest(0, floor(extract(epoch from (
          greatest(assignment_episode.active_from, ${resolved.from.toISOString()}::timestamptz)
            - ${resolved.from.toISOString()}::timestamptz
        )) / ${WEEK_SECONDS})::integer),
        least(${bucketCount - 1}, floor(extract(epoch from (
          least(assignment_episode.active_to, ${new Date(lastTimestamp).toISOString()}::timestamptz)
            - ${resolved.from.toISOString()}::timestamptz
            - interval '1 millisecond'
        )) / ${WEEK_SECONDS})::integer)
      ) as bucket
      from assignment_episode
      where assignment_episode.active_from < assignment_episode.active_to
        and assignment_episode.active_to > ${resolved.from.toISOString()}::timestamptz
        and assignment_episode.active_from < ${new Date(lastTimestamp).toISOString()}::timestamptz
    ), completion as (
      select coalesce(${person}, ${UNASSIGNED_PERSON_ID}) as person_id,
        floor(extract(epoch from (issue.completed_at - ${resolved.from.toISOString()}::timestamptz)) / ${WEEK_SECONDS})::integer as bucket
      from issue join workflow_state on workflow_state.id = issue.state_id
      where ${peopleHistoricalPredicate(
        principal,
        resolved,
        sql`coalesce(${person}, ${UNASSIGNED_PERSON_ID})`,
        personIds,
      )}
        and issue.completed_at is not null and ${completedInterval(resolved)}
    ), active_bucket as (
      select assignment_bucket.person_id, assignment_bucket.bucket from assignment_bucket
      union
      select completion.person_id, completion.bucket from completion
    )
    select person_id, count(distinct bucket) as active_weeks
    from active_bucket where bucket >= 0 and bucket < ${bucketCount}
    group by person_id
  `);
  return new Map(rows.map((row) => [row.person_id, Number(row.active_weeks)]));
}

function optionalNumber(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function distribution(
  valid: number | string | undefined,
  p50: number | string | null | undefined,
  p85: number | string | null | undefined,
): PersonDistribution {
  return { valid: Number(valid ?? 0), p50: optionalNumber(p50), p85: optionalNumber(p85) };
}

function attribution(row: CompletionStatRow | undefined): PersonAttributionSummary {
  const captured = Number(row?.captured ?? 0);
  const reconstructed = Number(row?.reconstructed ?? 0);
  const currentAssignee = Number(row?.current_assignee ?? 0);
  const nonzero = [captured, reconstructed, currentAssignee].filter((value) => value > 0).length;
  let kind: PersonAttributionCoverage = 'unavailable';
  if (nonzero > 1) kind = 'mixed';
  else if (captured > 0) kind = 'captured';
  else if (reconstructed > 0) kind = 'reconstructed';
  else if (currentAssignee > 0) kind = 'current_assignee';
  return { captured, reconstructed, currentAssignee, kind };
}

function personCohort(metric: string, personId: string): AnalyticsDrilldownCohort {
  return { cohort: `person-${metric}:${personId}` };
}

function analyticsRow(
  person: AnalyticsPerson,
  current: CurrentStatRow | undefined,
  completed: CompletionStatRow | undefined,
  weeks: number,
): PersonAnalyticsRow {
  const completedIssues = Number(completed?.completed_issues ?? 0);
  const completedPoints = Number(completed?.completed_points ?? 0);
  return {
    person,
    currentAssignments: Number(current?.current_assignments ?? 0),
    currentPoints: Number(current?.current_points ?? 0),
    completedIssues,
    completedPoints,
    activeWeeks: weeks,
    averageThroughputIssues: weeks === 0 ? 0 : completedIssues / weeks,
    averageThroughputPoints: weeks === 0 ? 0 : completedPoints / weeks,
    cycleTime: distribution(completed?.cycle_valid, completed?.cycle_p50, completed?.cycle_p85),
    leadTime: distribution(completed?.lead_valid, completed?.lead_p50, completed?.lead_p85),
    currentWip: Number(current?.current_wip ?? 0),
    currentWipPoints: Number(current?.current_wip_points ?? 0),
    wipAge: distribution(current?.wip_age_valid, current?.wip_age_p50, current?.wip_age_p85),
    blocked: Number(current?.blocked ?? 0),
    overdue: Number(current?.overdue ?? 0),
    stale: Number(current?.stale ?? 0),
    unestimated: Number(current?.unestimated ?? 0),
    currentProjects: Number(current?.current_projects ?? 0),
    currentMilestones: Number(current?.current_milestones ?? 0),
    currentSprints: Number(current?.current_sprints ?? 0),
    attribution: attribution(completed),
    cohorts: {
      currentAssignments: personCohort('current', person.id),
      completed: personCohort('completed', person.id),
      wip: personCohort('wip', person.id),
      blocked: personCohort('blocked', person.id),
      overdue: personCohort('overdue', person.id),
      stale: personCohort('stale', person.id),
      unestimated: personCohort('unestimated', person.id),
    },
  };
}

async function focusGroups(
  personId: string,
  currentBase: SQL<unknown>,
): Promise<readonly GroupRow[]> {
  const personPredicate =
    personId === UNASSIGNED_PERSON_ID
      ? sql`issue.assignee_id is null`
      : sql`issue.assignee_id = ${personId}`;
  return await db.execute<GroupRow>(sql`
    with current_work as materialized (
      select issue.* from issue join workflow_state on workflow_state.id = issue.state_id
      where ${currentBase} and ${personPredicate}
        and workflow_state.category not in ('completed', 'canceled')
    ), dimensions as (
      select 'project'::text as dimension, project.id, project.name,
        count(*) as issues, coalesce(sum(coalesce(current_work.estimate, 1)), 0) as points
      from current_work join project on project.id = current_work.project_id
      group by project.id, project.name
      union all
      select 'milestone', milestone.id, milestone.name, count(*),
        coalesce(sum(coalesce(current_work.estimate, 1)), 0)
      from current_work join milestone on milestone.id = current_work.milestone_id
      group by milestone.id, milestone.name
      union all
      select 'sprint', cycle.id, case when cycle.name = '' then 'Sprint ' || cycle.number else cycle.name end,
        count(*), coalesce(sum(coalesce(current_work.estimate, 1)), 0)
      from current_work join cycle on cycle.id = current_work.cycle_id
      group by cycle.id, cycle.name, cycle.number
      union all
      select 'state', workflow_state.id, workflow_state.name, count(*),
        coalesce(sum(coalesce(current_work.estimate, 1)), 0)
      from current_work join workflow_state on workflow_state.id = current_work.state_id
      group by workflow_state.id, workflow_state.name
    ), ranked as (
      select dimensions.*, row_number() over (
        partition by dimensions.dimension order by lower(dimensions.name), dimensions.id
      ) as rank from dimensions
    )
    select dimension, id, name, issues, points from ranked
    where rank <= ${PEOPLE_FOCUS_GROUP_LIMIT}
    order by dimension, lower(name), id
  `);
}

function groupedWork(
  rows: readonly GroupRow[],
  dimension: GroupRow['dimension'],
): PersonWorkGroup[] {
  return rows
    .filter((row) => row.dimension === dimension)
    .map((row) => ({
      id: row.id,
      name: row.name,
      issues: Number(row.issues),
      points: Number(row.points),
      cohort: { cohort: `person-${dimension}:${row.id}` },
    }));
}

async function focusTimeline(
  personId: string,
  historicalBase: SQL<unknown>,
  resolved: ResolvedAnalyticsQuery,
): Promise<readonly PersonTimelinePoint[]> {
  const starts = bucketDates(resolved.resolvedRange, resolved.bucket).slice(
    0,
    PEOPLE_TIMELINE_LIMIT,
  );
  if (starts.length === 0) return [];
  const buckets = starts.map((start, index) => {
    const end = starts[index + 1] ?? resolved.to;
    return sql`(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, ${calendarDateLabel(start, resolved.timezone)})`;
  });
  const person = completionAttributionPerson();
  const assignmentMatch =
    personId === UNASSIGNED_PERSON_ID
      ? sql`coalesce(assignment_event.to_value ->> 'id', assignment_event.to_value #>> '{}') is null`
      : sql`coalesce(assignment_event.to_value ->> 'id', assignment_event.to_value #>> '{}') = ${personId}`;
  const completionMatch =
    personId === UNASSIGNED_PERSON_ID ? sql`${person} is null` : sql`${person} = ${personId}`;
  const rows = await db.execute<TimelineRow>(sql`
    with buckets(bucket_start, bucket_end, date) as (values ${sql.join(buckets, sql`, `)}),
    assignments as (
      select assignment_event.issue_id, assignment_event.created_at, issue.estimate
      from issue_activity assignment_event
      join issue on issue.id = assignment_event.issue_id
      join workflow_state on workflow_state.id = issue.state_id
      where ${historicalBase} and assignment_event.field = 'assigneeId' and ${assignmentMatch}
    ), completions as (
      select issue.id, issue.completed_at, issue.estimate
      from issue join workflow_state on workflow_state.id = issue.state_id
      where ${historicalBase} and issue.completed_at is not null and ${completionMatch}
    ), assignment_issue_bucket as (
      select distinct buckets.date, assignments.issue_id, assignments.estimate
      from buckets
      join assignments on assignments.created_at >= buckets.bucket_start
        and assignments.created_at < buckets.bucket_end
    ), assignment_bucket as (
      select assignment_issue_bucket.date, count(*) as issues,
        coalesce(sum(coalesce(assignment_issue_bucket.estimate, 1)), 0) as points
      from assignment_issue_bucket
      group by assignment_issue_bucket.date
    ), completion_bucket as (
      select buckets.date, count(distinct completions.id) as issues,
        coalesce(sum(coalesce(completions.estimate, 1)), 0) as points
      from buckets
      join completions on completions.completed_at >= buckets.bucket_start
        and completions.completed_at < buckets.bucket_end
      group by buckets.date
    )
    select buckets.date,
      coalesce(assignment_bucket.issues, 0) as assigned_issues,
      coalesce(assignment_bucket.points, 0) as assigned_points,
      coalesce(completion_bucket.issues, 0) as completed_issues,
      coalesce(completion_bucket.points, 0) as completed_points
    from buckets
    left join assignment_bucket on assignment_bucket.date = buckets.date
    left join completion_bucket on completion_bucket.date = buckets.date
    order by buckets.bucket_start
  `);
  return rows.map((row) => ({
    date: row.date,
    assignedIssues: Number(row.assigned_issues),
    assignedPoints: Number(row.assigned_points),
    completedIssues: Number(row.completed_issues),
    completedPoints: Number(row.completed_points),
    assignedCohort: { cohort: `person-assigned:${personId}`, bucket: row.date },
    completedCohort: { cohort: `person-completed:${personId}`, bucket: row.date },
  }));
}

async function personalSprintBurn(
  principal: Principal,
  query: AnalyticsQuery,
  personId: string,
  context: PeopleAnalyticsContext,
): Promise<PersonSprintBurnSelection> {
  if (personId === UNASSIGNED_PERSON_ID) return { selected: null, current: null, previous: null };
  const [cycle] = await db
    .select({ id: schema.cycle.id })
    .from(schema.cycle)
    .where(eq(schema.cycle.organizationId, principal.organizationId))
    .limit(1);
  if (cycle === undefined) return { selected: null, current: null, previous: null };
  const sprint = await loadSprintAnalytics(
    principal,
    { ...query, lens: 'sprints', focus: { ...query.focus, personId } },
    {
      ...(context.now === undefined ? {} : { now: context.now }),
      ...(context.timezone === undefined ? {} : { timezone: context.timezone }),
      ...(context.cursorSecret === undefined ? {} : { cursorSecret: context.cursorSecret }),
      ...(context.selectedSprintId === undefined
        ? {}
        : { selectedSprintId: context.selectedSprintId }),
    },
  );
  if (sprint.current === null) return { selected: null, current: null, previous: null };
  return {
    selected: sprint.selected,
    current: sprint.current.people.find((entry) => entry.personId === personId) ?? null,
    previous: sprint.previous?.people.find((entry) => entry.personId === personId) ?? null,
  };
}

function formulas(): PeopleFormulaMetadata {
  return {
    currentAssignments:
      'Current non-archived, non-canceled open issues assigned to the person. This is a live Now metric.',
    completed:
      'Issues whose final completedAt falls inside the reporting window, attributed at completion with the best available assignment evidence.',
    activeWeek:
      'Completed issues or points divided by distinct reporting weeks with an observed assignment episode or an attributed completion. Reporting weeks are consecutive seven-day buckets anchored at the range start. Assignee activity bounds observed episodes at reassignment, and current terminal timestamps bound fallback episodes. Earlier close and reopen intervals are included only when retained activity supports them.',
    cycleTime:
      'Percentiles use valid startedAt to completedAt intervals for attributed completions. Missing or negative intervals are excluded and the valid count is shown.',
    leadTime:
      'Percentiles use valid createdAt to completedAt intervals for attributed completions. Negative intervals are excluded and the valid count is shown.',
    wipAge:
      'Current started or review work uses the duration from stateEnteredAt to the report asOf time.',
    attribution:
      'Captured close outcomes are preferred, assignment activity reconstructs the assignee at completion next, and current-assignee is the labeled fallback when neither fact exists.',
    points:
      'Unestimated work counts as 1 point until estimated. Counts and points are planning signals, not measures of employee value or effort.',
  };
}

function focusedHistoryBase(
  principal: Principal,
  resolved: ResolvedAnalyticsQuery,
  focusId: string | null,
): SQL<unknown> | undefined {
  if (focusId === null) return undefined;
  const historical = historicalPersonFilter(resolved, focusId);
  return sql`${baseAnalyticsPredicate(principal, historical.query)} and ${historical.matches}`;
}

export async function loadPeopleAnalytics(
  principal: Principal,
  query: AnalyticsQuery,
  context: PeopleAnalyticsContext = {},
): Promise<PeopleAnalytics> {
  assertCan(principal, 'analytics:read');
  const resolved = await resolveOverviewQuery(principal, query, context);
  const currentBase = baseAnalyticsPredicate(principal, resolved);
  const focusId = selectedPersonId(principal, query);
  const historicalBase = baseAnalyticsPredicate(principal, resolved);
  const focusedHistoricalBase = focusedHistoryBase(principal, resolved, focusId);
  const selected = selectedPeople(query);
  const list = await identities(principal, selected);
  const focusedRow =
    focusId === null
      ? undefined
      : (list.find((row) => row.id === focusId) ?? (await focusedIdentity(principal, focusId)));
  const visible =
    focusedRow === undefined || list.some((row) => row.id === focusedRow.id)
      ? list
      : [...list, focusedRow];
  const personIds = [...new Set(visible.map((row) => row.id))];
  const [current, completed, weeks] = await Promise.all([
    currentStats(currentBase, resolved),
    completionStats(principal, resolved, personIds),
    activeWeeks(principal, resolved, personIds),
  ]);
  const byId = new Map<string, PersonAnalyticsRow>();
  for (const row of visible) {
    const person = identity(row);
    byId.set(
      person.id,
      analyticsRow(
        person,
        current.get(person.id),
        completed.get(person.id),
        weeks.get(person.id) ?? 0,
      ),
    );
  }
  const people = list.flatMap((row): PersonAnalyticsRow[] => {
    const found = byId.get(row.id);
    return found === undefined ? [] : [found];
  });
  let focused: PersonAnalyticsDetail | null = null;
  const focusedBase = focusId === null ? undefined : byId.get(focusId);
  if (focusId !== null && focusedBase !== undefined) {
    const [groups, timeline, sprintBurn] = await Promise.all([
      focusGroups(focusId, currentBase),
      focusTimeline(focusId, focusedHistoricalBase ?? historicalBase, resolved),
      personalSprintBurn(principal, query, focusId, context),
    ]);
    focused = {
      ...focusedBase,
      projects: groupedWork(groups, 'project'),
      milestones: groupedWork(groups, 'milestone'),
      sprints: groupedWork(groups, 'sprint'),
      states: groupedWork(groups, 'state'),
      timeline,
      sprintBurn,
    };
  }
  const totalPeople = Number(list[0]?.total_people ?? 0);
  return {
    lens: 'people',
    asOf: resolved.asOf.toISOString(),
    people,
    totalPeople,
    truncated: totalPeople > people.length,
    focused,
    coverage: { kind: 'live', from: null, asOf: resolved.asOf.toISOString() },
    formulas: formulas(),
  };
}
