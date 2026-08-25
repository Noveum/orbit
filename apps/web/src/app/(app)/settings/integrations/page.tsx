import { can } from '@orbit/shared/policy';
import {
  GithubConnectNotice,
  githubConnectStatusOf,
  misroutedGithubInstall,
} from '@/features/settings/github-connect-notice.tsx';
import { GithubDeliveries } from '@/features/settings/github-deliveries.tsx';
import {
  loadGithubDeliveries,
  loadIntegrationSettings,
} from '@/features/settings/integrations-data.ts';
import { IntegrationsPanel } from '@/features/settings/integrations-panel.tsx';
import { loadMcpConnections } from '@/features/settings/mcp-data.ts';
import { pageContext } from '@/lib/api/handler.ts';
import { mcpServerUrl } from '@/lib/env.ts';

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal } = await pageContext();
  const query = await searchParams;
  const githubStatus =
    githubConnectStatusOf(query['github']) ?? (misroutedGithubInstall(query) ? 'misrouted' : null);
  const [settings, mcpConnections, deliveries] = await Promise.all([
    loadIntegrationSettings(principal),
    loadMcpConnections(principal.userId),
    loadGithubDeliveries(principal),
  ]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Integrations</h2>
        <p className="text-muted text-xs">
          Connect GitHub and compatible MCP clients. Orbit verifies GitHub webhooks, links pull
          requests to issues, and keeps both sides in sync in realtime.
        </p>
      </div>
      {githubStatus === null ? null : <GithubConnectNotice status={githubStatus} />}
      <IntegrationsPanel
        settings={settings}
        canManage={can(principal, 'integration:manage')}
        mcpUrl={mcpServerUrl()}
        mcpConnections={mcpConnections}
      />
      <GithubDeliveries deliveries={deliveries} />
    </section>
  );
}
