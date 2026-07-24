'use client';

import { MIN_PASSWORD_LENGTH } from '@orbit/shared/validators';
import { KeyRound, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { OrbitMark } from '@/components/brand/orbit-logo.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';

export interface ResetPasswordFormProps {
  readonly token: string | null;
}

const TOO_SHORT = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
const MISMATCH = 'Those passwords do not match.';

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token === null) {
    return (
      <div className="flex w-full flex-col gap-4 text-center" data-testid="reset-invalid">
        <OrbitMark size={36} className="mx-auto" />
        <h1 className="font-medium text-text text-xl">Reset link expired</h1>
        <p className="text-muted text-xs">
          That password reset link is invalid or has already been used. Request a new one from the
          sign in screen.
        </p>
        <Button asChild variant="secondary" size="md" block>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_PASSWORD_LENGTH && confirm === password;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(TOO_SHORT);
      return;
    }
    if (password !== confirm) {
      setError(MISMATCH);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) throw new Error(result.error.message ?? 'Could not reset your password.');
      toast({
        title: 'Password updated',
        description: 'Sign in with your new password.',
        tone: 'success',
      });
      window.location.assign('/login?reset=success');
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-5" data-testid="reset-form">
      <div className="flex flex-col gap-1.5 text-center">
        <OrbitMark size={36} className="mx-auto" />
        <h1 className="font-medium text-text text-xl">Choose a new password</h1>
        <p className="text-muted text-xs">Pick something you have not used here before.</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="reset-password" className="sr-only">
          New password
        </label>
        <Input
          id="reset-password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={tooShort}
          placeholder="New password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="reset-confirm" className="sr-only">
          Confirm new password
        </label>
        <Input
          id="reset-confirm"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          required
          aria-invalid={mismatch}
          placeholder="Confirm new password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <Button type="submit" variant="primary" size="md" block disabled={busy || !ready}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="size-4" aria-hidden="true" />
          )}
          Reset password
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-center text-danger text-xs">
          {error}
        </p>
      )}
    </form>
  );
}
