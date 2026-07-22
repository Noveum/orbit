import { ORG_ROLE_RANK, type OrgRole } from '../constants/index.ts';
import { forbidden } from '../errors/index.ts';

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
  'attachment:delete',
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
  'org:manage',
  'integration:manage',
  'agent:delegate',
  'audit:read',
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
  'attachment:delete',
  'project:manage',
  'cycle:manage',
  'milestone:manage',
  'workflow:manage',
  'label:manage',
  'doc:write',
  'doc:publish',
  'agent:delegate',
  'member:invite',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MEMBER_PERMISSIONS,
  'team:manage',
  'member:manage',
  'org:manage',
  'integration:manage',
  'audit:read',
];

const PERMISSIONS_BY_ROLE: Record<OrgRole, readonly Permission[]> = {
  guest: GUEST_PERMISSIONS,
  contributor: CONTRIBUTOR_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
};

export interface Principal {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: OrgRole;
  readonly teamIds: readonly string[];
}

export function permissionsFor(role: OrgRole): readonly Permission[] {
  return PERMISSIONS_BY_ROLE[role];
}

export function can(principal: Principal, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[principal.role].includes(permission);
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) {
    throw forbidden(`Your role cannot ${permission.replace(':', ' ')}.`, {
      details: { permission, role: principal.role },
    });
  }
}

export function isInTeam(principal: Principal, teamId: string): boolean {
  return principal.role === 'admin' || principal.teamIds.includes(teamId);
}

export function assertInTeam(principal: Principal, teamId: string): void {
  if (!isInTeam(principal, teamId)) {
    throw forbidden('You are not a member of that team.', { details: { teamId } });
  }
}

export function atLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum];
}

export function canAssignRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return actorRole === 'admin' && ORG_ROLE_RANK[targetRole] <= ORG_ROLE_RANK.admin;
}
