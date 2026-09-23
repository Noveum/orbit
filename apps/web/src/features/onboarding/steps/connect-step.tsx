'use client';

import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';
import { StarterPromptPicker } from '../../ai-connect/starter-prompt-picker.tsx';
import {
  type McpConnectionsState,
  useMcpConnections,
} from '../../ai-connect/use-mcp-connections.ts';
import { CopyRow } from '../../settings/integration-card.tsx';
import { mcpClients } from '../../settings/mcp-install-links.ts';
import { McpClientTile } from '../../settings/mcp-panel.tsx';
import { advanceStep } from '../api.ts';
import type { OnboardingStatusView } from '../types.ts';

export interface ConnectStepProps {
  readonly mcpUrl: string;
  readonly onNext: (status: OnboardingStatusView) => void;
}

export function ConnectStep({ mcpUrl, onNext }: ConnectStepProps) {
  const clients = mcpClients(mcpUrl);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = clients.find((client) => client.id === clientId);
  const status = useMcpConnections();
  const connected = status.connections.length > 0;

  async function next(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      onNext(await advanceStep({ step: 'connect' }));
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="onboarding-connect">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">Bring your work in with AI</h1>
        <p className="text-muted text-dense">
          Connect the AI tool you already use. It can move your tasks over from another app, or plan
          a project with you from scratch, in a couple of minutes.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="connect-client-heading">
        <h2 id="connect-client-heading" className="font-medium text-dense text-text">
          1. Connect your AI tool
        </h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-2xs text-muted">Your Orbit MCP server URL</span>
          <CopyRow
            value={mcpUrl}
            label="Copy MCP server URL"
            testId="onboarding-mcp-url"
            onError={setError}
          />
        </div>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">AI tool</legend>
          {clients.map((client) => {
            const active = client.id === clientId;
            return (
              <label
                key={client.id}
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-1 text-xs',
                  tabHover,
                  'focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2',
                  active
                    ? 'border-accent bg-surface-2 text-text'
                    : 'border-border bg-surface text-muted',
                )}
              >
                <input
                  type="radio"
                  name="onboarding-ai-client"
                  value={client.id}
                  checked={active}
                  onChange={() => setClientId(client.id)}
                  className="sr-only"
                />
                {client.name}
              </label>
            );
          })}
        </fieldset>
        {selected === undefined ? null : (
          <ul>
            <McpClientTile client={selected} mcpUrl={mcpUrl} onError={setError} />
          </ul>
        )}
        <ConnectionStatus status={status} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="connect-prompt-heading">
        <h2 id="connect-prompt-heading" className="font-medium text-dense text-text">
          2. Give it a starter prompt
        </h2>
        <StarterPromptPicker
          onError={setError}
          {...(selected === undefined ? {} : { clientId: selected.id, clientName: selected.name })}
        />
      </section>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => next().catch(() => undefined)}
          disabled={pending}
        >
          Continue
        </Button>
        {connected ? null : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => next().catch(() => undefined)}
            disabled={pending}
          >
            Skip for now
          </Button>
        )}
      </div>
      {connected ? null : (
        <p className="text-2xs text-faint">
          You can connect later from Settings, then MCP server. The starter prompts live there too.
        </p>
      )}
    </div>
  );
}

function ConnectionStatus({ status }: { status: McpConnectionsState }) {
  const [first] = status.connections;
  if (first !== undefined) {
    const names = [...new Set(status.connections.map((connection) => connection.clientName))];
    return (
      <p role="status" className="flex items-center gap-2 text-dense text-text">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        Connected: {names.join(', ')}. Now give it a starter prompt.
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-muted text-xs">
      <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      {status.error === null
        ? 'Waiting for your AI tool. This updates as soon as you approve it.'
        : `Could not check the connection yet: ${status.error}`}
    </p>
  );
}
