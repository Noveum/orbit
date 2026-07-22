import { and, db, eq, gt, schema } from '@orbit/db';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { z } from 'zod';

export interface ConnectionPrincipal {
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
  readonly organizationId: string;
  readonly role: OrgRole;
  readonly teamIds: readonly string[];
}

const roleSchema = z.enum(ORG_ROLES).catch('guest');

const scopePattern = /^(org|team|user|project|issue|doc):(.+)$/;

async function loadTeamIds(userId: string, organizationId: string, role: OrgRole) {
  if (role === 'admin') {
    const rows = await db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(eq(schema.team.organizationId, organizationId));
    return rows.map((row) => row.id);
  }
  const rows = await db
    .select({ id: schema.team.id })
    .from(schema.teamMember)
    .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
    .where(
      and(eq(schema.teamMember.userId, userId), eq(schema.team.organizationId, organizationId)),
    );
  return rows.map((row) => row.id);
}

export async function authenticateToken(token: string): Promise<ConnectionPrincipal | null> {
  const sessions = await db
    .select({
      userId: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      activeOrganizationId: schema.session.activeOrganizationId,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(and(eq(schema.session.token, token), gt(schema.session.expiresAt, new Date())))
    .limit(1);

  const found = sessions[0];
  if (found === undefined) return null;

  const memberships = await db
    .select({ organizationId: schema.member.organizationId, role: schema.member.role })
    .from(schema.member)
    .where(eq(schema.member.userId, found.userId));

  const active =
    memberships.find((row) => row.organizationId === found.activeOrganizationId) ?? memberships[0];
  if (active === undefined) return null;

  const role = roleSchema.parse(active.role);

  return {
    userId: found.userId,
    name: found.name,
    image: found.image,
    organizationId: active.organizationId,
    role,
    teamIds: await loadTeamIds(found.userId, active.organizationId, role),
  };
}

async function issueScopeAllowed(issueId: string, principal: ConnectionPrincipal) {
  const rows = await db
    .select({ organizationId: schema.issue.organizationId, teamId: schema.issue.teamId })
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId))
    .limit(1);
  const found = rows[0];
  return (
    found !== undefined &&
    found.organizationId === principal.organizationId &&
    principal.teamIds.includes(found.teamId)
  );
}

async function projectScopeAllowed(projectId: string, principal: ConnectionPrincipal) {
  const rows = await db
    .select({ organizationId: schema.project.organizationId })
    .from(schema.project)
    .where(eq(schema.project.id, projectId))
    .limit(1);
  return rows[0]?.organizationId === principal.organizationId;
}

async function docScopeAllowed(docId: string, principal: ConnectionPrincipal) {
  const rows = await db
    .select({ organizationId: schema.doc.organizationId })
    .from(schema.doc)
    .where(eq(schema.doc.id, docId))
    .limit(1);
  return rows[0]?.organizationId === principal.organizationId;
}

export async function authorizeScope(
  scope: string,
  principal: ConnectionPrincipal,
): Promise<boolean> {
  const match = scopePattern.exec(scope);
  if (match === null) return false;
  const kind = match[1] ?? '';
  const id = match[2] ?? '';

  switch (kind) {
    case 'org':
      return id === principal.organizationId;
    case 'team':
      return principal.teamIds.includes(id);
    case 'user':
      return id === principal.userId;
    case 'issue':
      return await issueScopeAllowed(id, principal);
    case 'project':
      return await projectScopeAllowed(id, principal);
    case 'doc':
      return await docScopeAllowed(id, principal);
    default:
      return false;
  }
}
