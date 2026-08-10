import { and, asc, db, eq, gt, inArray, isNull, lte, schema, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';

export interface SprintRollUpRow {
  readonly teamId: string;
  readonly cycleId: string;
  readonly number: number;
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly committedIssues: number;
  readonly completedIssues: number;
  readonly committedPoints: number;
  readonly completedPoints: number;
}

const COMMITTED = sql`${schema.workflowState.category} not in ('triage', 'backlog', 'canceled')`;
const DONE = sql`${schema.workflowState.category} = 'completed'`;

function visibleTeams(principal: Principal, teamIds: readonly string[]): string[] {
  if (principal.role === 'admin') return [...teamIds];
  return teamIds.filter((teamId) => principal.teamIds.includes(teamId));
}

export async function listSprintRollUp(
  principal: Principal,
  teamIds: readonly string[],
  now: Date = new Date(),
): Promise<SprintRollUpRow[]> {
  assertCan(principal, 'issue:read');
  const visible = visibleTeams(principal, teamIds);
  if (visible.length === 0) return [];

  return await db
    .select({
      teamId: schema.cycle.teamId,
      cycleId: schema.cycle.id,
      number: schema.cycle.number,
      name: schema.cycle.name,
      startsAt: schema.cycle.startsAt,
      endsAt: schema.cycle.endsAt,
      committedIssues: sql<number>`count(${schema.issue.id}) filter (where ${COMMITTED})`.mapWith(
        Number,
      ),
      completedIssues:
        sql<number>`count(${schema.issue.id}) filter (where ${COMMITTED} and ${DONE})`.mapWith(
          Number,
        ),
      committedPoints:
        sql<number>`coalesce(sum(${schema.issue.estimate}) filter (where ${COMMITTED}), 0)`.mapWith(
          Number,
        ),
      completedPoints:
        sql<number>`coalesce(sum(${schema.issue.estimate}) filter (where ${COMMITTED} and ${DONE}), 0)`.mapWith(
          Number,
        ),
    })
    .from(schema.cycle)
    .leftJoin(
      schema.issue,
      and(eq(schema.issue.cycleId, schema.cycle.id), isNull(schema.issue.archivedAt)),
    )
    .leftJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        inArray(schema.cycle.teamId, visible),
        isNull(schema.cycle.archivedAt),
        isNull(schema.cycle.completedAt),
        lte(schema.cycle.startsAt, now),
        gt(schema.cycle.endsAt, now),
      ),
    )
    .groupBy(schema.cycle.id)
    .orderBy(asc(schema.cycle.endsAt));
}
