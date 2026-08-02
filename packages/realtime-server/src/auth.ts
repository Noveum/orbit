import { and, db, eq, gt, schema } from '@orbit/db';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { authMessageSchema } from '@orbit/shared/events';
import { type RealtimeTicketPayload, verifyRealtimeTicket } from '@orbit/shared/events/ticket';
import { z } from 'zod';

export interface ConnectionPrincipal {
  readonly userId: string;
  readonly sessionId: string;
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

interface SessionUser {
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
}

async function toPrincipal(
  user: SessionUser,
  membership: { readonly organizationId: string; readonly role: string },
  sessionId: string,
): Promise<ConnectionPrincipal> {
  const role = roleSchema.parse(membership.role);
  return {
    userId: user.userId,
    sessionId,
    name: user.name,
    image: user.image,
    organizationId: membership.organizationId,
    role,
    teamIds: await loadTeamIds(user.userId, membership.organizationId, role),
  };
}

export type ConnectionRejection = 'unauthorized' | 'organization_forbidden';

export type ConnectionAuthentication =
  | { readonly ok: true; readonly principal: ConnectionPrincipal }
  | { readonly ok: false; readonly reason: ConnectionRejection };

export function readTicketFrame(
  raw: string,
  secret: string,
  now?: number,
): RealtimeTicketPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = authMessageSchema.safeParse(parsed);
  if (!frame.success) return null;
  return verifyRealtimeTicket(frame.data.ticket, secret, now);
}

export async function authenticateTicket(
  payload: RealtimeTicketPayload,
): Promise<ConnectionAuthentication> {
  const sessions = await db
    .select({
      userId: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(
      and(
        eq(schema.session.id, payload.sessionId),
        eq(schema.session.userId, payload.userId),
        gt(schema.session.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const found = sessions[0];
  if (found === undefined) return { ok: false, reason: 'unauthorized' };

  const memberships = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, found.userId),
        eq(schema.member.organizationId, payload.organizationId),
      ),
    )
    .limit(1);

  const membership = memberships[0];
  if (membership === undefined) return { ok: false, reason: 'organization_forbidden' };

  return {
    ok: true,
    principal: await toPrincipal(
      found,
      { organizationId: payload.organizationId, role: membership.role },
      payload.sessionId,
    ),
  };
}

export const memberDeleteSchema = z.object({ userId: z.string().min(1) });

export async function sessionStillValid(sessionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(and(eq(schema.session.id, sessionId), gt(schema.session.expiresAt, new Date())))
    .limit(1);
  return rows.length > 0;
}

export async function membershipStillValid(principal: ConnectionPrincipal): Promise<boolean> {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function issueScopeAllowed(issueId: string, principal: ConnectionPrincipal) {
  const rows = await db
    .select({ organizationId: schema.issue.organizationId, teamId: schema.issue.teamId })
    .from(schema.issue)
    .where(eq(schema.issue.id, issueId))
    .limit(1);
  const issue = rows[0];
  if (issue === undefined || issue.organizationId !== principal.organizationId) return false;
  return principal.role === 'admin' || principal.teamIds.includes(issue.teamId);
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
