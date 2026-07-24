import { and, asc, db, eq, inArray, isNull, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import { assertInTeam, type Principal, teamScope } from '@orbit/shared/policy';
import type { ShellTeam } from './navigation.ts';

export async function assertTeamInWorkspace(principal: Principal, teamId: string): Promise<void> {
  const [row] = await db
    .select({ teamId: schema.team.id, organizationId: schema.team.organizationId })
    .from(schema.team)
    .where(
      and(eq(schema.team.id, teamId), eq(schema.team.organizationId, principal.organizationId)),
    )
    .limit(1);
  if (row === undefined) throw notFound('That team does not exist.', { details: { teamId } });
  assertInTeam(principal, teamScope(row));
}

export async function listTeamsForPrincipal(principal: Principal): Promise<ShellTeam[]> {
  if (principal.role !== 'admin' && principal.teamIds.length === 0) return [];

  const scopedToMembership =
    principal.role === 'admin' ? undefined : inArray(schema.team.id, [...principal.teamIds]);

  const rows = await db
    .select({ id: schema.team.id, key: schema.team.key, name: schema.team.name })
    .from(schema.team)
    .where(
      and(
        eq(schema.team.organizationId, principal.organizationId),
        isNull(schema.team.archivedAt),
        scopedToMembership,
      ),
    )
    .orderBy(asc(schema.team.name));

  return rows;
}
