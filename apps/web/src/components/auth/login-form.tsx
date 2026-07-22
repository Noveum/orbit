'use client';

import { Fingerprint, Loader2, MailCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { authClient } from '@/lib/auth/client.ts';
import { GithubMark, GoogleMark } from './provider-icons.tsx';

const CALLBACK_URL = '/my-issues';

export interface LoginFormProps {
  readonly providers: readonly string[];
}

type Pending = 'passkey' | 'google' | 'github' | 'magic-link' | null;

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export function LoginForm({ providers }: LoginFormProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [linkSent, setLinkSent] = useState(false);

  const withPending = async (kind: Exclude<Pending, null>, run: () => Promise<void>) => {
    setPending(kind);
    try {
      await run();
    } catch (error: unknown) {
      toast({
        title: 'Sign in failed',
        description: messageOf(error, 'Try again.'),
        tone: 'danger',
      });
    } finally {
      setPending(null);
    }
  };

  const signInWithPasskey = () =>
    withPending('passkey', async () => {
      const result = await authClient.signIn.passkey();
      if (result?.error) throw new Error(result.error.message ?? 'No passkey available.');
      window.location.assign(CALLBACK_URL);
    });

  const signInWithSocial = (provider: 'google' | 'github') =>
    withPending(provider, async () => {
      const result = await authClient.signIn.social({ provider, callbackURL: CALLBACK_URL });
      if (result.error) throw new Error(result.error.message ?? 'That provider is unavailable.');
    });

  const sendMagicLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    withPending('magic-link', async () => {
      const result = await authClient.signIn.magicLink({ email, callbackURL: CALLBACK_URL });
      if (result.error) throw new Error(result.error.message ?? 'Could not send the link.');
      setLinkSent(true);
      toast({
        title: 'Check your email',
        description: `A sign in link is on its way to ${email}.`,
      });
    });
  };

  return (
    <div className="flex w-full max-w-[22rem] flex-col gap-5">
      <div className="flex flex-col gap-1.5 text-center">
        <span className="mx-auto flex size-9 items-center justify-center rounded-lg bg-accent font-semibold text-accent-contrast text-base">
          O
        </span>
        <h1 className="font-medium text-text text-xl">Sign in to Orbit</h1>
        <p className="text-muted text-xs">Passwordless by design. Pick how you want in.</p>
      </div>

      <Button
        variant="primary"
        size="md"
        block
        disabled={pending !== null}
        onClick={() => {
          signInWithPasskey();
        }}
      >
        {pending === 'passkey' ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Fingerprint className="size-4" aria-hidden="true" />
        )}
        Continue with passkey
      </Button>

      {providers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {providers.includes('google') ? (
            <Button
              variant="secondary"
              size="md"
              block
              disabled={pending !== null}
              onClick={() => {
                signInWithSocial('google');
              }}
            >
              <GoogleMark className="size-4" />
              Continue with Google
            </Button>
          ) : null}
          {providers.includes('github') ? (
            <Button
              variant="secondary"
              size="md"
              block
              disabled={pending !== null}
              onClick={() => {
                signInWithSocial('github');
              }}
            >
              <GithubMark className="size-4" />
              Continue with GitHub
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-2xs text-faint uppercase tracking-wide">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={sendMagicLink} className="flex flex-col gap-2">
        <label htmlFor="login-email" className="sr-only">
          Email address
        </label>
        <Input
          id="login-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="md"
          block
          disabled={pending !== null || email.length === 0}
        >
          {pending === 'magic-link' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <MailCheck className="size-4" aria-hidden="true" />
          )}
          Email me a link
        </Button>
        {linkSent ? (
          <output className="text-center text-success text-xs">Link sent. Check your inbox.</output>
        ) : null}
      </form>

      <p className="text-center text-2xs text-faint">
        Orbit never asks for a password. Sessions expire after 30 days.
      </p>
    </div>
  );
}
