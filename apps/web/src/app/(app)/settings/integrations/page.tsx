import { listMcpGrants } from '@orbit/core';
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
  const [settings, grants, deliveries] = await Promise.all([
    loadIntegrationSettings(principal),
    listMcpGrants(principal.userId),
    loadGithubDeliveries(principal),
  ]);
  const mcpConnections = grants.map((grant) => ({
    id: grant.id,
    clientName: grant.clientName,
    organizationName: grant.organizationName,
    lastUsedAt: grant.lastUsedAt === null ? null : grant.lastUsedAt.toISOString(),
  }));

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Integrations</h2>
        <p className="text-muted text-xs">
          Connect GitHub, Slack, and any MCP-aware AI client. Orbit verifies every webhook, links
          pull requests to issues, and keeps both sides in sync in realtime.
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
