import { and, asc, db, eq, inArray, isNull, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import type { ShellTeam } from './navigation.ts';

export async function listTeamsForPrincipal(principal: Principal): Promise<ShellTeam[]> {
  const scopedToMembership =
    principal.teamIds.length > 0 && principal.role !== 'admin'
      ? inArray(schema.team.id, [...principal.teamIds])
      : undefined;

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
