import { forbidden } from '../errors/index.ts';
import type { Principal } from './index.ts';

export type McpIdentity =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'agent'; readonly id: string; readonly name: string };

export interface McpToolAccess {
  readonly reads: boolean;
  readonly writes: boolean;
  readonly identity: McpIdentity;
  readonly agentIssueWrites?: boolean;
}

export interface McpToolOperation {
  readonly readOnly: boolean;
  readonly agentSafe?: boolean;
  readonly agentWrite?: boolean;
}

export function canUseMcpTool(access: McpToolAccess, operation: McpToolOperation): boolean {
  if (access.identity.kind === 'agent') {
    if (operation.readOnly) return access.reads && operation.agentSafe !== false;
    return access.writes && access.agentIssueWrites === true && operation.agentWrite === true;
  }
  return operation.readOnly ? access.reads : access.writes;
}

export function assertMcpToolAccess(access: McpToolAccess, operation: McpToolOperation): void {
  if (!canUseMcpTool(access, operation)) {
    throw forbidden(
      access.identity.kind === 'agent'
        ? 'This Agent connection cannot perform that operation.'
        : 'This connection does not hold the scope required by this tool.',
    );
  }
}

export function assertMcpGrantOwner(
  principal: Pick<Principal, 'userId' | 'organizationId'>,
  grant: { readonly userId: string | null; readonly organizationId: string },
): void {
  if (grant.userId !== principal.userId || grant.organizationId !== principal.organizationId) {
    throw forbidden('Only the owner of this connection can revoke it.');
  }
}

export function assertAgentIdentityOwner(
  principal: Pick<Principal, 'userId' | 'organizationId'>,
  identity: {
    readonly ownerUserId: string | null;
    readonly organizationId: string;
    readonly clientId: string | null;
  },
  clientId: string,
): void {
  if (
    identity.ownerUserId !== principal.userId ||
    identity.organizationId !== principal.organizationId ||
    identity.clientId !== clientId
  ) {
    throw forbidden('Choose an identity owned by you in this workspace and bound to this client.');
  }
}
