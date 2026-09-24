'use client';

import { Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { CopyRow } from '../settings/integration-card.tsx';

export function AiConnectBanner({ mcpUrl }: { readonly mcpUrl: string }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dismiss(): Promise<void> {
    setDismissed(true);
    setError(null);
    try {
      await apiRequest('/api/onboarding/ai-connect-hint', { method: 'DELETE', body: {} });
      router.refresh();
    } catch (caught) {
      setDismissed(false);
      setError(messageOf(caught));
    }
  }

  if (dismissed) return null;

  return (
    <section
      aria-label="Connect an AI tool"
      data-testid="ai-connect-banner"
      className="flex items-start gap-3 border-border border-b bg-surface-2 px-4 py-3"
    >
      <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-dense text-text">Bring your work into Orbit with AI</p>
        <p className="text-muted text-xs">
          Connect Claude, ChatGPT, Cursor or another AI tool, then paste a starter prompt. It can
          move your tasks over from the app you use today, or plan a project with you from scratch.
        </p>
        {error === null ? null : (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href="/settings/mcp">Connect an AI tool</Link>
          </Button>
          <div className="w-full max-w-md">
            <CopyRow
              value={mcpUrl}
              label="Copy MCP server URL"
              testId="ai-connect-banner-url"
              onError={setError}
            />
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="px-1.5"
        aria-label="Dismiss"
        onClick={() => dismiss().catch(() => undefined)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </section>
  );
}
