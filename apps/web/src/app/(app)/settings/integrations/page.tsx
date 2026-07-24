import { can } from '@orbit/shared/policy';
import { loadIntegrationSettings } from '@/features/settings/integrations-data.ts';
import { IntegrationsPanel } from '@/features/settings/integrations-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { mcpServerUrl } from '@/lib/env.ts';

export default async function IntegrationsSettingsPage() {
  const { principal } = await pageContext();
  const settings = await loadIntegrationSettings(principal);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Integrations</h2>
        <p className="text-muted text-xs">
          Connect GitHub, Slack, and any MCP-aware AI client. Orbit verifies every webhook, links
          pull requests to issues, and keeps both sides in sync in realtime.
        </p>
      </div>
      <IntegrationsPanel
        settings={settings}
        canManage={can(principal, 'integration:manage')}
        mcpUrl={mcpServerUrl()}
      />
    </section>
  );
}
