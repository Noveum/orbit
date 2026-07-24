'use client';

import { MIN_PASSWORD_LENGTH } from '@orbit/shared/validators';
import { KeyRound, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';

export interface PasswordPanelProps {
  readonly hasPassword: boolean;
}

const TOO_SHORT = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
const MISMATCH = 'Those passwords do not match.';

export function PasswordPanel({ hasPassword }: PasswordPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready =
    next.length >= MIN_PASSWORD_LENGTH && confirm === next && (!hasPassword || current.length > 0);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(TOO_SHORT);
      return;
    }
    if (next !== confirm) {
      setError(MISMATCH);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (hasPassword) {
        const result = await authClient.changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true,
        });
        if (result.error)
          throw new Error(result.error.message ?? 'Could not change your password.');
        toast({ title: 'Password changed', tone: 'success' });
      } else {
        await apiRequest('/api/account/password', { method: 'POST', body: { newPassword: next } });
        toast({ title: 'Password set', tone: 'success' });
      }
      reset();
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex max-w-sm flex-col gap-4"
      data-testid="password-panel"
      data-mode={hasPassword ? 'change' : 'set'}
    >
      {hasPassword ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password-current" className="font-medium text-dense text-text">
            Current password
          </label>
          <Input
            id="password-current"
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password-new" className="font-medium text-dense text-text">
          New password
        </label>
        <Input
          id="password-new"
          type="password"
          name="new-password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={tooShort}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <p className="text-2xs text-faint">At least {MIN_PASSWORD_LENGTH} characters.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password-confirm" className="font-medium text-dense text-text">
          Confirm new password
        </label>
        <Input
          id="password-confirm"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          aria-invalid={mismatch}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </div>

      <div>
        <Button type="submit" variant="primary" disabled={busy || !ready}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="size-4" aria-hidden="true" />
          )}
          {hasPassword ? 'Change password' : 'Set password'}
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </form>
  );
}
