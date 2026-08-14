import { isRestricted, ORG_ROLE_RANK, type OrgRole } from '../constants/index.ts';
import { forbidden, notFound } from '../errors/index.ts';

export const PERMISSIONS = [
  'issue:read',
  'issue:create',
  'issue:update',
  'issue:delete',
  'comment:create',
  'comment:update:own',
  'comment:delete:any',
  'reaction:toggle',
  'attachment:upload',
  'project:read',
  'project:manage',
  'cycle:manage',
  'milestone:manage',
  'team:manage',
  'workflow:manage',
  'label:manage',
  'view:manage',
  'doc:read',
  'doc:write',
  'doc:publish',
  'member:invite',
  'member:manage',
  'integration:manage',
  'org:manage',
  'org:delete',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const GUEST_PERMISSIONS: readonly Permission[] = [
  'issue:read',
  'comment:create',
  'comment:update:own',
  'reaction:toggle',
  'project:read',
  'doc:read',
];

const CONTRIBUTOR_PERMISSIONS: readonly Permission[] = [
  ...GUEST_PERMISSIONS,
  'issue:create',
  'issue:update',
  'attachment:upload',
  'view:manage',
];

const MEMBER_PERMISSIONS: readonly Permission[] = [
  ...CONTRIBUTOR_PERMISSIONS,
  'issue:delete',
  'comment:delete:any',
  'project:manage',
  'cycle:manage',
  'milestone:manage',
  'workflow:manage',
  'label:manage',
  'doc:write',
  'doc:publish',
  'member:invite',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MEMBER_PERMISSIONS,
  'team:manage',
  'member:manage',
  'integration:manage',
  'org:manage',
  'org:delete',
];

const PERMISSIONS_BY_ROLE: Record<OrgRole, readonly Permission[]> = Object.assign(
  Object.create(null) as Record<OrgRole, readonly Permission[]>,
  {
    guest: GUEST_PERMISSIONS,
    contributor: CONTRIBUTOR_PERMISSIONS,
    member: MEMBER_PERMISSIONS,
    admin: ADMIN_PERMISSIONS,
  },
);

export interface Principal {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: OrgRole;
  readonly teamIds: readonly string[];
}

const NO_PERMISSIONS: readonly Permission[] = [];

export function permissionsFor(role: OrgRole): readonly Permission[] {
  return PERMISSIONS_BY_ROLE[role] ?? NO_PERMISSIONS;
}

export function can(principal: Principal, permission: Permission): boolean {
  return permissionsFor(principal.role).includes(permission);
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) {
    throw forbidden(`Your role cannot ${permission.replace(':', ' ')}.`, {
      details: { permission, role: principal.role },
    });
  }
}

export interface TeamScope {
  readonly id: string;
  readonly organizationId: string;
}

export function teamScope(row: {
  readonly teamId: string;
  readonly organizationId: string;
}): TeamScope {
  return { id: row.teamId, organizationId: row.organizationId };
}

export function isInTeam(principal: Principal, team: TeamScope): boolean {
  if (team.organizationId !== principal.organizationId) return false;
  return principal.role === 'admin' || principal.teamIds.includes(team.id);
}

export function assertInTeam(principal: Principal, team: TeamScope): void {
  if (team.organizationId !== principal.organizationId) {
    throw notFound('That team does not exist.', { details: { teamId: team.id } });
  }
  if (!isInTeam(principal, team)) {
    throw forbidden('You are not a member of that team.', { details: { teamId: team.id } });
  }
}

export function atLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum];
}

export function canAssignRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return actorRole === 'admin' && ORG_ROLE_RANK[targetRole] <= ORG_ROLE_RANK.admin;
}

export interface ReadableDocRow {
  readonly id: string;
  readonly organizationId: string;
  readonly authorId: string;
  readonly visibility: string;
}

export interface DocReader {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: OrgRole;
}

export function canReadDoc(
  principal: DocReader,
  doc: ReadableDocRow,
  grantedDocIds: readonly string[],
): boolean {
  if (doc.organizationId !== principal.organizationId) return false;
  if (principal.role === 'admin') return true;
  if (doc.authorId === principal.userId) return true;
  if (!isRestricted(doc.visibility)) return true;
  return grantedDocIds.includes(doc.id);
}

export interface ReadableViewRow {
  readonly organizationId: string;
  readonly ownerId: string;
  readonly visibility: string;
  readonly teamId: string | null;
}

export function canReadView(principal: Principal, view: ReadableViewRow): boolean {
  if (view.organizationId !== principal.organizationId) return false;
  if (view.ownerId === principal.userId) return true;
  if (view.visibility === 'workspace') return true;
  if (view.visibility !== 'team' || view.teamId === null) return false;
  return isInTeam(principal, { id: view.teamId, organizationId: view.organizationId });
}
