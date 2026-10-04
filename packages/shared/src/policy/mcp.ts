import { forbidden } from '../errors/index.ts';
import type { Principal } from './index.ts';

export type McpIdentity =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'agent'; readonly id: string; readonly name: string };

export interface McpToolAccess {
  readonly reads: boolean;
  readonly writes: boolean;
  readonly identity: McpIdentity;
}

export interface McpToolOperation {
  readonly readOnly: boolean;
  readonly agentSafe?: boolean;
}

export function canUseMcpTool(access: McpToolAccess, operation: McpToolOperation): boolean {
  if (access.identity.kind === 'agent' && (!operation.readOnly || operation.agentSafe === false)) {
    return false;
  }
  return operation.readOnly ? access.reads : access.writes;
}

export function assertMcpToolAccess(access: McpToolAccess, operation: McpToolOperation): void {
  if (!canUseMcpTool(access, operation)) {
    throw forbidden(
      access.identity.kind === 'agent'
        ? 'Agent connections can only use tools without write side effects.'
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
