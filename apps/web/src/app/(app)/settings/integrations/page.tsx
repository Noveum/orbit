import { can } from '@orbit/shared/policy';
import {
  GithubConnectNotice,
  githubConnectStatusOf,
  misroutedGithubInstall,
} from '@/features/settings/github-connect-notice.tsx';
import { GithubDeliveries } from '@/features/settings/github-deliveries.tsx';
import { integrationProvider } from '@/features/settings/integration-provider.ts';
import {
  loadGithubDeliveries,
  loadIntegrationSettings,
} from '@/features/settings/integrations-data.ts';
import { IntegrationsPanel } from '@/features/settings/integrations-panel.tsx';
import { loadMcpConnections } from '@/features/settings/mcp-data.ts';
import {
  SlackConnectNotice,
  slackConnectStatusOf,
} from '@/features/settings/slack-connect-notice.tsx';
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
  const slackStatus = slackConnectStatusOf(query['slack']);
  const [settings, mcpConnections, deliveries] = await Promise.all([
    loadIntegrationSettings(principal),
    loadMcpConnections(principal.userId),
    loadGithubDeliveries(principal),
  ]);

  const canManage = can(principal, 'integration:manage');
  const requestedProvider = query['provider'] ?? (slackStatus === null ? 'github' : 'slack');
  const provider = integrationProvider(requestedProvider, canManage, settings.slack !== undefined);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Integrations</h2>
        <p className="text-muted text-xs">Manage your GitHub, Slack, and MCP connections.</p>
      </div>
      {githubStatus === null ? null : <GithubConnectNotice status={githubStatus} />}
      {slackStatus === null ? null : <SlackConnectNotice status={slackStatus} />}
      <IntegrationsPanel
        key={provider}
        settings={settings}
        canManage={canManage}
        provider={provider}
        mcpUrl={mcpServerUrl()}
        mcpConnections={mcpConnections}
      />
      {provider === 'github' ? <GithubDeliveries deliveries={deliveries} /> : null}
    </section>
  );
}
