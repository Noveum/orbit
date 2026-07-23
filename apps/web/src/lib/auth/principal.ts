import { selectActiveMembership } from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';

function toOrgRole(value: string): OrgRole {
  const match = ORG_ROLES.find((role) => role === value);
  return match ?? 'guest';
}

export interface MembershipContext {
  readonly principal: Principal;
  readonly memberId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
}

export async function resolveMembership(
  userId: string,
  organizationId: string | null,
): Promise<MembershipContext | null> {
  const memberships = await db
    .select({
      memberId: schema.member.id,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      organizationId: schema.organization.id,
      organizationName: schema.organization.name,
      organizationSlug: schema.organization.slug,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId));

  const row = selectActiveMembership(memberships, organizationId);
  if (row === undefined) return null;

  const teams = await db
    .select({ teamId: schema.teamMember.teamId })
    .from(schema.teamMember)
    .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
    .where(
      and(eq(schema.teamMember.userId, userId), eq(schema.team.organizationId, row.organizationId)),
    );

  return {
    memberId: row.memberId,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    principal: {
      userId,
      organizationId: row.organizationId,
      role: toOrgRole(row.role),
      teamIds: teams.map((team) => team.teamId),
    },
  };
}
