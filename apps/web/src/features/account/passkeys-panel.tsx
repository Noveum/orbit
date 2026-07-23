'use client';

import { relativeTime } from '@orbit/shared/utils';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import { removalBlockReason } from './credentials.ts';
import type { PasskeyView } from './data.ts';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function deviceLabel(passkey: PasskeyView): string {
  if (passkey.backedUp) return 'Synced passkey';
  return passkey.deviceType === 'multiDevice' ? 'Multi device' : 'This device only';
}

export interface PasskeysPanelProps {
  readonly passkeys: readonly PasskeyView[];
  readonly accountCount: number;
}

export function PasskeysPanel({ passkeys, accountCount }: PasskeysPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const blockedReason = removalBlockReason({
    accounts: accountCount,
    passkeys: passkeys.length,
  });

  const addPasskey = async (): Promise<void> => {
    setAdding(true);
    setError(null);
    try {
      const result = await authClient.passkey.addPasskey({
        name: newName.trim().length === 0 ? 'Passkey' : newName.trim(),
      });
      if (result?.error) throw new Error(result.error.message ?? 'Could not add that passkey.');
      setNewName('');
      toast({ title: 'Passkey added', tone: 'success' });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setAdding(false);
    }
  };

  const rename = async (id: string): Promise<void> => {
    const name = renameValue.trim();
    if (name.length === 0) return;
    setBusyId(id);
    setError(null);
    try {
      const result = await authClient.passkey.updatePasskey({ id, name });
      if (result.error) throw new Error(result.error.message ?? 'Could not rename that passkey.');
      setRenamingId(null);
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest('/api/account/credentials', {
        method: 'DELETE',
        body: { kind: 'passkey', id },
      });
      toast({ title: 'Passkey removed', tone: 'success' });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="passkeys-panel">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-52 flex-1 flex-col gap-1.5">
          <label htmlFor="passkey-name" className="font-medium text-dense text-text">
            Name this passkey
          </label>
          <Input
            id="passkey-name"
            value={newName}
            maxLength={64}
            placeholder="Work laptop"
            onChange={(event) => setNewName(event.target.value)}
          />
        </div>
        <Button
          variant="primary"
          disabled={adding}
          data-testid="add-passkey"
          onClick={() => {
            addPasskey();
          }}
        >
          {adding ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Fingerprint className="size-4" aria-hidden="true" />
          )}
          Add passkey
        </Button>
      </div>

      {blockedReason === null ? null : (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-muted text-xs">
          {blockedReason}
        </p>
      )}

      {passkeys.length === 0 ? (
        <EmptyState
          icon={<Fingerprint strokeWidth={1.75} aria-hidden="true" />}
          title="No passkeys yet"
          description="Add one so you can sign in with Touch ID, Windows Hello, or a security key."
        />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="passkey-list">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              data-testid={`passkey-${passkey.id}`}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5',
                cardHover,
              )}
            >
              <Fingerprint className="size-4 shrink-0 text-faint" aria-hidden="true" />
              {renamingId === passkey.id ? (
                <>
                  <Input
                    className="min-w-40 max-w-56 flex-1"
                    value={renameValue}
                    maxLength={64}
                    aria-label={`New name for ${passkey.name}`}
                    onChange={(event) => setRenameValue(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busyId === passkey.id}
                    onClick={() => {
                      rename(passkey.id);
                    }}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2 font-medium text-dense text-text">
                      {passkey.name}
                      <Badge tone="outline">{deviceLabel(passkey)}</Badge>
                    </span>
                    <span className="truncate text-2xs text-faint">
                      Added {formatDate(passkey.createdAt)}
                      {passkey.lastUsedAt === null
                        ? ', never used yet'
                        : `, last used ${relativeTime(new Date(passkey.lastUsedAt))}`}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setRenamingId(passkey.id);
                      setRenameValue(passkey.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={blockedReason !== null || busyId === passkey.id}
                    title={blockedReason ?? undefined}
                    onClick={() => {
                      remove(passkey.id);
                    }}
                  >
                    Remove
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
