import {
  and,
  asc,
  db,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  schema,
  sql,
} from '@orbit/db';
import { OPEN_STATE_CATEGORIES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { standupBoardQuerySchema } from '@orbit/shared/validators';
import { ISSUE_LIST_COLUMNS, type IssueListRow, visibleTeamFilters } from './issue-service.ts';

export const MAX_BOARD_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const DEFAULT_BOARD_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface StandupWorkloadRow {
  readonly userId: string;
  readonly open: number;
  readonly inProgress: number;
  readonly completedSince: number;
}

export interface StandupBoard {
  readonly since: Date;
  readonly issues: readonly IssueListRow[];
  readonly workload: readonly StandupWorkloadRow[];
}

export function boardSince(now: Date, requested: string | undefined): Date {
  const fallback = now.getTime() - DEFAULT_BOARD_LOOKBACK_MS;
  const requestedAt = requested === undefined ? Number.NaN : Date.parse(requested);
  const wanted = Number.isNaN(requestedAt) ? fallback : requestedAt;
  const earliest = now.getTime() - MAX_BOARD_LOOKBACK_MS;
  return new Date(Math.min(Math.max(wanted, earliest), now.getTime()));
}

function boardUniverse(principal: Principal, since: Date): SQL[] {
  const filters: SQL[] = [
    eq(schema.issue.organizationId, principal.organizationId),
    ...visibleTeamFilters(principal),
    isNull(schema.issue.archivedAt),
    isNotNull(schema.issue.assigneeId),
  ];
  const stillOpenOrJustCompleted = or(
    isNull(schema.issue.completedAt),
    gte(schema.issue.completedAt, since),
  );
  if (stillOpenOrJustCompleted !== undefined) filters.push(stillOpenOrJustCompleted);
  const stillOpenOrJustCanceled = or(
    isNull(schema.issue.canceledAt),
    gte(schema.issue.canceledAt, since),
  );
  if (stillOpenOrJustCanceled !== undefined) filters.push(stillOpenOrJustCanceled);
  return filters;
}

const BUCKET_RANK = sql`case when ${schema.workflowState.category} in ('completed', 'canceled') then 0 when ${schema.workflowState.category} in ('started', 'review') then 1 else 2 end`;

async function boardIssues(
  principal: Principal,
  universe: SQL[],
  limitPerPerson: number,
): Promise<IssueListRow[]> {
  const ranked = db
    .select({
      id: schema.issue.id,
      rank: sql<number>`row_number() over (partition by ${schema.issue.assigneeId}, ${BUCKET_RANK} order by ${schema.issue.updatedAt} desc)`.as(
        'rank',
      ),
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(and(...universe))
    .as('ranked');

  return await db
    .select(ISSUE_LIST_COLUMNS)
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.organizationId, principal.organizationId),
        inArray(
          schema.issue.id,
          db.select({ id: ranked.id }).from(ranked).where(sql`${ranked.rank} <= ${limitPerPerson}`),
        ),
      ),
    )
    .orderBy(asc(schema.issue.assigneeId), desc(schema.issue.updatedAt));
}

async function boardWorkload(universe: SQL[], since: Date): Promise<StandupWorkloadRow[]> {
  const rows = await db
    .select({
      userId: sql<string>`${schema.issue.assigneeId}`.as('user_id'),
      open: sql<number>`count(*) filter (where ${inArray(schema.workflowState.category, [...OPEN_STATE_CATEGORIES])})`.as(
        'open_count',
      ),
      inProgress:
        sql<number>`count(*) filter (where ${schema.workflowState.category} in ('started', 'review'))`.as(
          'in_progress',
        ),
      completedSince:
        sql<number>`count(*) filter (where ${schema.issue.completedAt} >= ${since.toISOString()}::timestamptz)`.as(
          'completed_since',
        ),
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(and(...universe))
    .groupBy(schema.issue.assigneeId);

  return rows.map((row) => ({
    userId: row.userId,
    open: Number(row.open),
    inProgress: Number(row.inProgress),
    completedSince: Number(row.completedSince),
  }));
}

export async function standupBoard(
  principal: Principal,
  input: unknown = {},
): Promise<StandupBoard> {
  assertCan(principal, 'issue:read');
  const query = standupBoardQuerySchema.parse(input);
  const since = boardSince(new Date(), query.since);
  const universe = boardUniverse(principal, since);

  const [issues, workload] = await Promise.all([
    boardIssues(principal, universe, query.limitPerPerson),
    boardWorkload(universe, since),
  ]);

  return { since, issues, workload };
}
