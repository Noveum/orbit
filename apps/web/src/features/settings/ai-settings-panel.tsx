'use client';

import type { AiProviderKind } from '@orbit/shared/validators';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';

export interface AiSettingsData {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly kind: AiProviderKind | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly hasApiKey: boolean;
  readonly usage: {
    readonly totalCalls: number;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface AiSettingsPanelProps {
  readonly settings: AiSettingsData;
  readonly canManage: boolean;
}

interface TestResponse {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly message?: string;
  readonly error?: string;
}

function defaultEndpoint(kind: AiProviderKind): { baseUrl: string; model: string } {
  if (kind === 'anthropic') {
    return { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' };
  }
  return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
}

function shouldResetBaseUrl(current: string): boolean {
  return (
    current === '' ||
    current === 'https://api.anthropic.com' ||
    current === 'https://api.openai.com/v1'
  );
}

function shouldResetModel(current: string): boolean {
  return current === '' || current === 'claude-3-5-sonnet-20241022' || current === 'gpt-4o-mini';
}

function AiConsentNotice() {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm text-text">Data Consent and Privacy</h3>
          <Badge tone="outline">Off by default</Badge>
        </div>
        <p className="text-muted text-xs leading-relaxed">
          Orbit only transmits prompts to your designated inference provider when an AI feature is
          explicitly triggered. Data sent may include issue titles, descriptions, and comments
          directly relevant to the request. All generated outputs are suggestions: nothing produced
          by a model is ever applied without explicit human acceptance.
        </p>
      </div>
    </div>
  );
}

function AiUsageCards({ usage }: { readonly usage: AiSettingsData['usage'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-border bg-surface p-3">
        <span className="text-muted text-xs">Total calls</span>
        <p className="font-semibold text-lg text-text">{usage.totalCalls}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <span className="text-muted text-xs">Total tokens</span>
        <p className="font-semibold text-lg text-text">{usage.totalTokens.toLocaleString()}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <span className="text-muted text-xs">Prompt tokens</span>
        <p className="font-semibold text-lg text-text">{usage.promptTokens.toLocaleString()}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <span className="text-muted text-xs">Completion tokens</span>
        <p className="font-semibold text-lg text-text">{usage.completionTokens.toLocaleString()}</p>
      </div>
    </div>
  );
}

function AiFeedbackBanner({
  statusMessage,
  errorMessage,
  testResult,
}: {
  readonly statusMessage: string | null;
  readonly errorMessage: string | null;
  readonly testResult: TestResponse | null;
}) {
  if (statusMessage !== null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-400 text-xs"
      >
        {statusMessage}
      </div>
    );
  }

  if (errorMessage !== null) {
    return (
      <div
        role="alert"
        className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-400 text-xs"
      >
        {errorMessage}
      </div>
    );
  }

  if (testResult !== null) {
    const isOk = testResult.ok;
    const borderClass = isOk
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : 'border-rose-500/30 bg-rose-500/10 text-rose-400';
    return (
      <div
        role={isOk ? 'status' : 'alert'}
        aria-live={isOk ? 'polite' : undefined}
        className={`rounded-md border px-3 py-2 text-xs ${borderClass}`}
      >
        {isOk ? (
          <span>
            Connection successful ({testResult.latencyMs}ms): &quot;{testResult.message}&quot;
          </span>
        ) : (
          <span>Connection failed: {testResult.error}</span>
        )}
      </div>
    );
  }

  return null;
}

interface AiProviderInputsProps {
  readonly kind: AiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly enabled: boolean;
  readonly hasApiKey: boolean;
  readonly canManage: boolean;
  readonly onKindChange: (kind: AiProviderKind) => void;
  readonly onBaseUrlChange: (url: string) => void;
  readonly onModelChange: (model: string) => void;
  readonly onApiKeyChange: (key: string) => void;
  readonly onEnabledChange: (enabled: boolean) => void;
}

function AiProviderInputs(props: AiProviderInputsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="ai-kind" className="block font-medium text-xs text-text">
          Provider shape
        </label>
        <select
          id="ai-kind"
          value={props.kind}
          disabled={!props.canManage}
          onChange={(e) => props.onKindChange(e.target.value as AiProviderKind)}
          className="mt-1 block w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-dense text-text"
        >
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="anthropic">Anthropic-compatible</option>
        </select>
      </div>

      <div>
        <label htmlFor="ai-base-url" className="block font-medium text-xs text-text">
          Base URL
        </label>
        <input
          id="ai-base-url"
          type="url"
          value={props.baseUrl}
          disabled={!props.canManage}
          onChange={(e) => props.onBaseUrlChange(e.target.value)}
          placeholder={
            props.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
          }
          className="mt-1 block w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-dense text-text"
        />
        <p className="mt-1 text-2xs text-muted">
          Local endpoints such as http://localhost:11434/v1 or custom proxy gateways work here.
        </p>
      </div>

      <div>
        <label htmlFor="ai-model" className="block font-medium text-xs text-text">
          Model identifier
        </label>
        <input
          id="ai-model"
          type="text"
          value={props.model}
          disabled={!props.canManage}
          onChange={(e) => props.onModelChange(e.target.value)}
          placeholder={props.kind === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini'}
          className="mt-1 block w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-dense text-text"
        />
      </div>

      <div>
        <label htmlFor="ai-api-key" className="block font-medium text-xs text-text">
          API Key
        </label>
        <input
          id="ai-api-key"
          type="password"
          value={props.apiKey}
          disabled={!props.canManage}
          onChange={(e) => props.onApiKeyChange(e.target.value)}
          placeholder={props.hasApiKey ? 'Keep saved key or enter new key' : 'Paste your API key'}
          className="mt-1 block w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-dense text-text font-mono"
        />
        {props.hasApiKey ? (
          <p className="mt-1 text-2xs text-emerald-400">
            An encrypted API key is already configured for this workspace.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <input
          id="ai-enabled-toggle"
          type="checkbox"
          checked={props.enabled}
          disabled={!props.canManage}
          onChange={(e) => props.onEnabledChange(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <label htmlFor="ai-enabled-toggle" className="select-none font-medium text-xs text-text">
          Enable AI capabilities for this workspace
        </label>
      </div>
    </div>
  );
}

interface AiActionButtonsProps {
  readonly canManage: boolean;
  readonly isConfigured: boolean;
  readonly isTesting: boolean;
  readonly isSaving: boolean;
  readonly isDisconnecting: boolean;
  readonly isFormValid: boolean;
  readonly onTest: () => void;
  readonly onSave: () => void;
  readonly onDisconnect: () => void;
}

function AiActionButtons(props: AiActionButtonsProps) {
  if (!props.canManage) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={props.isTesting || props.isSaving || !props.isFormValid}
          onClick={props.onTest}
        >
          {props.isTesting ? 'Testing...' : 'Test connection'}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={props.isSaving || props.isTesting || !props.isFormValid}
          onClick={props.onSave}
        >
          {props.isSaving ? 'Saving...' : 'Save settings'}
        </Button>
      </div>
      {props.isConfigured ? (
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={props.isDisconnecting || props.isSaving || props.isTesting}
          onClick={props.onDisconnect}
        >
          {props.isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
        </Button>
      ) : null}
    </div>
  );
}

export function AiSettingsPanel({ settings, canManage }: AiSettingsPanelProps) {
  const router = useRouter();

  const initialKind = settings.kind ?? 'openai-compatible';
  const defaults = defaultEndpoint(initialKind);

  const [kind, setKind] = useState<AiProviderKind>(initialKind);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? defaults.baseUrl);
  const [model, setModel] = useState(settings.model ?? defaults.model);
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(settings.enabled);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleKindChange(nextKind: AiProviderKind) {
    setKind(nextKind);
    const fallback = defaultEndpoint(nextKind);
    if (shouldResetBaseUrl(baseUrl)) setBaseUrl(fallback.baseUrl);
    if (shouldResetModel(model)) setModel(fallback.model);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const payload = await apiRequest<TestResponse>('/api/settings/ai/test', {
        method: 'POST',
        body: {
          kind,
          baseUrl,
          model,
          apiKey: apiKey.trim().length > 0 ? apiKey.trim() : undefined,
        },
      });
      setTestResult(payload);
    } catch (caught) {
      setTestResult({ ok: false, error: messageOf(caught) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await apiRequest<AiSettingsData>('/api/settings/ai', {
        method: 'POST',
        body: {
          kind,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey: apiKey.trim().length > 0 ? apiKey.trim() : undefined,
          enabled,
        },
      });
      setStatusMessage('AI provider configuration saved.');
      setApiKey('');
      router.refresh();
    } catch (caught) {
      setErrorMessage(messageOf(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await apiRequest<{ ok: boolean }>('/api/settings/ai', {
        method: 'DELETE',
      });
      setStatusMessage('AI provider disconnected.');
      setApiKey('');
      router.refresh();
    } catch (caught) {
      setErrorMessage(messageOf(caught));
    } finally {
      setDisconnecting(false);
    }
  }

  const isFormValid = baseUrl.trim().length > 0 && model.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <AiConsentNotice />
      <AiUsageCards usage={settings.usage} />

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm text-text">Provider Settings</h3>
              <p className="text-muted text-xs">
                Point your workspace to any OpenAI-compatible or Anthropic endpoint.
              </p>
            </div>
            {settings.configured ? (
              <Badge tone={settings.enabled ? 'success' : 'neutral'}>
                {settings.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            ) : (
              <Badge tone="outline">Not configured</Badge>
            )}
          </div>

          <AiFeedbackBanner
            statusMessage={statusMessage}
            errorMessage={errorMessage}
            testResult={testResult}
          />

          <AiProviderInputs
            kind={kind}
            baseUrl={baseUrl}
            model={model}
            apiKey={apiKey}
            enabled={enabled}
            hasApiKey={settings.hasApiKey}
            canManage={canManage}
            onKindChange={handleKindChange}
            onBaseUrlChange={setBaseUrl}
            onModelChange={setModel}
            onApiKeyChange={setApiKey}
            onEnabledChange={setEnabled}
          />

          <AiActionButtons
            canManage={canManage}
            isConfigured={settings.configured}
            isTesting={testing}
            isSaving={saving}
            isDisconnecting={disconnecting}
            isFormValid={isFormValid}
            onTest={handleTest}
            onSave={handleSave}
            onDisconnect={handleDisconnect}
          />
        </div>
      </div>
    </div>
  );
}
