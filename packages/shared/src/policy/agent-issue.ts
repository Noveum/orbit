import { forbidden, unauthorized } from '../errors/index.ts';
import { assertCan, isInTeam, type Permission, type Principal } from './index.ts';

export interface AgentIssueAuthority {
  readonly principal: Principal;
  readonly scopes: readonly string[];
  readonly organizationId: string;
  readonly ownerUserId: string | null;
  readonly lifecycle: 'active' | 'disabled' | 'deleted';
  readonly connection: 'connected' | 'disconnected';
}

export function authorizeIssueAction(
  authority: AgentIssueAuthority,
  permission: Extract<Permission, 'issue:read' | 'issue:create' | 'issue:update' | 'issue:delete'>,
  resource: { readonly organizationId: string; readonly teamId: string },
): void {
  if (authority.lifecycle !== 'active' || authority.connection !== 'connected') {
    throw unauthorized('This agent cannot access issues.', {
      details: { reason: 'agent_inactive' },
    });
  }
  if (
    authority.ownerUserId !== authority.principal.userId ||
    authority.organizationId !== authority.principal.organizationId
  ) {
    throw unauthorized('This agent is not bound to its owner.', {
      details: { reason: 'agent_identity_required' },
    });
  }
  const requiredScope = permission === 'issue:read' ? 'orbit.read' : 'orbit.write';
  if (!authority.scopes.includes(requiredScope)) {
    throw forbidden('The grant does not allow this issue action.', {
      details: { reason: 'grant_scope_denied' },
    });
  }
  assertCan(authority.principal, permission);
  if (
    !isInTeam(authority.principal, { id: resource.teamId, organizationId: resource.organizationId })
  ) {
    throw forbidden('The agent owner cannot access this team.', {
      details: { reason: 'principal_permission_denied' },
    });
  }
}
