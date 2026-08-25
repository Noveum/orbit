import { loadMcpConnections } from '@/features/settings/mcp-data.ts';
import { McpPanel } from '@/features/settings/mcp-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { mcpServerUrl } from '@/lib/env.ts';

export default async function McpSettingsPage() {
  const { principal } = await pageContext();
  const connections = await loadMcpConnections(principal.userId);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">MCP server</h2>
        <p className="text-muted text-xs">
          Give Claude, ChatGPT, or another compatible MCP client access to your issues, docs, and
          projects. Every client signs in with OAuth and acts as you, so it can only reach what you
          can.
        </p>
      </div>
      <McpPanel mcpUrl={mcpServerUrl()} connections={connections} />
    </section>
  );
}
