import { listMcpGrants } from '@orbit/core';
import { McpPanel } from '@/features/settings/mcp-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { mcpServerUrl } from '@/lib/env.ts';

export default async function McpSettingsPage() {
  const { principal } = await pageContext();
  const grants = await listMcpGrants(principal.userId);
  const connections = grants.map((grant) => ({
    id: grant.id,
    clientName: grant.clientName,
    organizationName: grant.organizationName,
    lastUsedAt: grant.lastUsedAt === null ? null : grant.lastUsedAt.toISOString(),
  }));

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">MCP server</h2>
        <p className="text-muted text-xs">
          Give Claude, ChatGPT, or any other MCP client access to your issues, docs, and projects.
          Every client signs in with OAuth and acts as you, so it can only reach what you can.
        </p>
      </div>
      <McpPanel mcpUrl={mcpServerUrl()} connections={connections} />
    </section>
  );
}
