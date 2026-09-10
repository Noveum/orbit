import { and, db, desc, eq, ilike, or, schema, sql } from '@orbit/db';
import { validationFailed } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, isInTeam } from '@orbit/shared/policy';
import { issueFilterSchema, workspaceTasksQuerySchema } from '@orbit/shared/validators';
import { ZodError, z } from 'zod';
import { buildIssueWhere } from './issue-query.ts';

const cursorSchema = z.tuple([z.string().datetime(), z.string().uuid()]);

function decodeCursor(cursor: string): [string, string] {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch (cause) {
    throw validationFailed('That page cursor is not valid.', { cause });
  }
}

function parseFilters(input: unknown) {
  try {
    const query = workspaceTasksQuerySchema.parse(input);
    return { query, filter: issueFilterSchema.parse({ ...query, query: undefined }) };
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw validationFailed('Those workspace task filters are not valid.', { cause });
    }
    throw cause;
  }
}

export async function listWorkspaceTasks(principal: Principal, input: unknown = {}) {
  assertCan(principal, 'issue:read:workspace');
  const { query, filter } = parseFilters(input);
  const filters = [
    buildIssueWhere(principal, {
      visibility: 'workspace-tasks',
      filter,
      now: new Date(),
    }),
  ];
  if (query.query !== undefined && query.query.length > 0) {
    const term = `%${query.query}%`;
    filters.push(
      or(ilike(schema.issue.title, term), ilike(schema.issue.identifier, term)) ?? sql`false`,
    );
  }
  if (query.cursor !== undefined) {
    const [updatedAt, id] = decodeCursor(query.cursor);
    filters.push(
      sql`(${schema.issue.updatedAt}, ${schema.issue.id}) < (${updatedAt}::timestamptz, ${id})`,
    );
  }
  const rows = await db
    .select({
      id: schema.issue.id,
      identifier: schema.issue.identifier,
      title: schema.issue.title,
      teamId: schema.issue.teamId,
      team: schema.team.name,
      state: schema.workflowState.name,
      assignee: schema.user.name,
      project: schema.project.name,
      priority: schema.issue.priority,
      updatedAt: sql<string>`to_char(${schema.issue.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(schema.issue)
    .innerJoin(schema.team, eq(schema.team.id, schema.issue.teamId))
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .leftJoin(schema.user, eq(schema.user.id, schema.issue.assigneeId))
    .leftJoin(schema.project, eq(schema.project.id, schema.issue.projectId))
    .where(and(...filters))
    .orderBy(desc(schema.issue.updatedAt), desc(schema.issue.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    tasks: page.map(({ teamId, ...task }) => ({
      ...task,
      canOpen: isInTeam(principal, { id: teamId, organizationId: principal.organizationId }),
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? Buffer.from(JSON.stringify([last.updatedAt, last.id])).toString('base64url')
        : null,
  };
}
