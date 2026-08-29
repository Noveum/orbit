import { listMcpGrants } from '@orbit/core';
import type { McpConnection } from './mcp-panel.tsx';

export async function loadMcpConnections(userId: string): Promise<readonly McpConnection[]> {
  const grants = await listMcpGrants(userId);
  return grants.map((grant) => ({
    id: grant.id,
    clientName: grant.clientName,
    organizationName: grant.organizationName,
    lastUsedAt: grant.lastUsedAt === null ? null : grant.lastUsedAt.toISOString(),
  }));
}
