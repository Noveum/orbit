'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import type { DevUser } from '@/lib/api/dev-users.ts';

export interface DevSignInProps {
  readonly users: readonly DevUser[];
  readonly callbackUrl?: string;
}

export function DevSignIn({ users, callbackUrl = '/my-issues' }: DevSignInProps) {
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const signIn = async (email: string) => {
    setPending(email);
    try {
      const response = await fetch('/api/dev/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error('Dev sign in failed.');
      window.location.assign(callbackUrl);
    } catch (error: unknown) {
      setPending(null);
      toast({
        title: 'Dev sign in failed',
        description: error instanceof Error ? error.message : 'Try again.',
        tone: 'danger',
      });
    }
  };

  if (users.length === 0) return null;

  return (
    <div className="mt-6 flex flex-col gap-2 border-border border-t pt-5">
      <p className="text-2xs text-faint uppercase tracking-wide">Development sign in</p>
      <ul className="flex flex-col gap-1">
        {users.map((user) => (
          <li key={user.email}>
            <button
              type="button"
              data-testid={`dev-sign-in-${user.email}`}
              disabled={pending !== null}
              onClick={() => {
                signIn(user.email);
              }}
              className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-dense transition-colors duration-[var(--duration-fast)] not-disabled:hover:border-border not-disabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Avatar name={user.name} src={user.image} size="sm" />
              <span className="min-w-0 flex-1 truncate">Continue as {user.name}</span>
              {pending === user.email ? (
                <Loader2 className="size-3.5 animate-spin text-faint" aria-hidden="true" />
              ) : (
                <span className="truncate text-2xs text-faint">{user.email}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
