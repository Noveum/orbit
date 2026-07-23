'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GithubMark, GoogleMark } from '@/components/auth/provider-icons.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import { removalBlockReason } from './credentials.ts';
import type { ConnectedAccountView } from './data.ts';

const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google', Mark: GoogleMark },
  { id: 'github', label: 'GitHub', Mark: GithubMark },
] as const;

function describeProvider(
  label: string,
  configured: boolean,
  linked: ConnectedAccountView | undefined,
): string {
  if (linked !== undefined) return `Account ${linked.accountId}`;
  if (configured) return `Sign in to Orbit with ${label}.`;
  return `${label} is not configured on this server.`;
}

export interface ConnectedAccountsProps {
  readonly accounts: readonly ConnectedAccountView[];
  readonly passkeyCount: number;
  readonly availableProviders: readonly string[];
}

export function ConnectedAccounts({
  accounts,
  passkeyCount,
  availableProviders,
}: ConnectedAccountsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blockedReason = removalBlockReason({ accounts: accounts.length, passkeys: passkeyCount });

  const connect = async (provider: string): Promise<void> => {
    setPendingProvider(provider);
    setError(null);
    try {
      const result = await authClient.linkSocial({
        provider,
        callbackURL: '/settings/account/connections',
      });
      if (result.error) throw new Error(result.error.message ?? 'That provider is unavailable.');
    } catch (caught) {
      setError(messageOf(caught));
      setPendingProvider(null);
    }
  };

  const disconnect = async (account: ConnectedAccountView): Promise<void> => {
    setPendingProvider(account.providerId);
    setError(null);
    try {
      await apiRequest('/api/account/credentials', {
        method: 'DELETE',
        body: {
          kind: 'account',
          providerId: account.providerId,
          accountId: account.accountId,
        },
      });
      toast({ title: 'Disconnected', tone: 'success' });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="connected-accounts">
      {blockedReason === null ? null : (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-muted text-xs">
          {blockedReason}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {SOCIAL_PROVIDERS.map(({ id, label, Mark }) => {
          const linked = accounts.find((account) => account.providerId === id);
          const configured = availableProviders.includes(id);
          const busy = pendingProvider === id;

          return (
            <li
              key={id}
              data-testid={`provider-${id}`}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5',
                cardHover,
              )}
            >
              <Mark className="size-4 shrink-0 text-text" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-medium text-dense text-text">
                  {label}
                  {linked === undefined ? null : <Badge tone="success">Connected</Badge>}
                </span>
                <span className="truncate text-2xs text-faint">
                  {describeProvider(label, configured, linked)}
                </span>
              </span>

              {linked === undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!configured || busy}
                  onClick={() => {
                    connect(id);
                  }}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                  Connect
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={blockedReason !== null || busy}
                  title={blockedReason ?? undefined}
                  onClick={() => {
                    disconnect(linked);
                  }}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                  Disconnect
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
