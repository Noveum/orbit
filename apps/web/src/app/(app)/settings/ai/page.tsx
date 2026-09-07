import { loadAiProviderStatus, loadAiUsage } from '@orbit/services/ai';
import { can } from '@orbit/shared/policy';
import { AiSettingsPanel } from '@/features/settings/ai-settings-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function AiSettingsPage() {
  const { principal } = await pageContext();
  const canManage = can(principal, 'ai:manage');

  if (!canManage) {
    return (
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-lg text-text">AI provider</h2>
          <p className="text-muted text-xs">
            Inference provider configuration is limited to workspace administrators.
          </p>
        </div>
      </section>
    );
  }

  const [status, usage] = await Promise.all([
    loadAiProviderStatus(principal.organizationId),
    loadAiUsage(principal.organizationId),
  ]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">AI provider</h2>
        <p className="text-muted text-xs">
          Bring your own key and inference endpoint. Off by default, usage counted per workspace,
          and all model outputs are suggestions.
        </p>
      </div>

      <AiSettingsPanel
        settings={{
          configured: status.configured,
          enabled: status.enabled,
          kind: status.kind,
          baseUrl: status.baseUrl,
          model: status.model,
          hasApiKey: status.hasApiKey,
          usage,
        }}
        canManage={canManage}
      />
    </section>
  );
}
