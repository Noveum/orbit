import { and, eq, inArray, schema, sql } from '@orbit/db';
import { extractMentions } from '@orbit/shared/utils';
import type { Executor } from '../internal.ts';

export function newMentions(previous: string, next: string): string[] {
  const before = new Set(extractMentions(previous));
  return extractMentions(next).filter((handle) => !before.has(handle));
}

export async function resolveMentions(
  executor: Executor,
  organizationId: string,
  markdown: string,
  teamId: string | null,
): Promise<string[]> {
  return await resolveHandles(executor, organizationId, extractMentions(markdown), teamId);
}

export async function resolveHandles(
  executor: Executor,
  organizationId: string,
  handles: readonly string[],
  teamId: string | null,
): Promise<string[]> {
  const lowered = [...new Set(handles.map((handle) => handle.toLowerCase()))];
  if (lowered.length === 0) return [];
  const rows = await executor
    .select({ id: schema.user.id })
    .from(schema.user)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.userId, schema.user.id),
        eq(schema.member.organizationId, organizationId),
      ),
    )
    .where(
      and(
        inArray(sql`lower(${schema.user.handle})`, lowered),
        teamId === null
          ? sql`true`
          : sql`(${schema.member.role} = 'admin' or exists (select 1 from ${schema.teamMember} where ${schema.teamMember.userId} = ${schema.user.id} and ${schema.teamMember.teamId} = ${teamId}))`,
      ),
    );
  return rows.map((row) => row.id);
}
