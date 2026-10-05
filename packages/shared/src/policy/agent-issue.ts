import { forbidden } from '../errors/index.ts';
import type { Actor } from '../events/index.ts';
import { assertCan, type Permission, type Principal } from './index.ts';

export function assertAgentIssueWrite(
  principal: Principal,
  scopes: string,
  permission: Permission,
): void {
  if (!scopes.split(/\s+/).includes('orbit.write')) {
    throw forbidden('This Agent connection does not hold the Issue write scope.');
  }
  assertCan(principal, permission);
}

export function assertPersonalAgentAssignment(
  principal: Principal,
  actor: Actor,
  identity: {
    readonly id: string;
    readonly ownerUserId: string | null;
    readonly organizationId: string;
  },
): void {
  if (
    identity.organizationId !== principal.organizationId ||
    !(
      (actor.type === 'user' &&
        actor.id === identity.ownerUserId &&
        actor.id === principal.userId) ||
      (actor.type === 'agent' && actor.id === identity.id)
    )
  ) {
    throw forbidden('Only this Personal Agent or its Owner can assign it.');
  }
}
