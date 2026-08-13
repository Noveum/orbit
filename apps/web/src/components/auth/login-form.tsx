'use client';

import { signInCodeRequestSchema, signInCodeVerifySchema } from '@orbit/shared/validators';
import { Fingerprint, KeyRound, Loader2, MailCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { OrbitMark } from '@/components/brand/orbit-logo.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { authClient } from '@/lib/auth/client.ts';
import { GithubMark, GoogleMark } from './provider-icons.tsx';

const DEFAULT_CALLBACK_URL = '/my-issues';
const MIN_PASSWORD_LENGTH = 12;

export interface LoginFormProps {
  readonly providers: readonly string[];
  readonly callbackUrl?: string;
  readonly passwordEnabled?: boolean;
}

type Pending =
  | 'passkey'
  | 'google'
  | 'github'
  | 'otp-send'
  | 'otp-verify'
  | 'password'
  | 'forgot'
  | null;

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

function NameField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <>
      <label htmlFor="login-name" className="sr-only">
        Full name
      </label>
      <Input
        id="login-name"
        type="text"
        name="name"
        autoComplete="name"
        required
        placeholder="Your name"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}

interface PasswordFieldProps {
  readonly creatingAccount: boolean;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly busy: boolean;
  readonly disabled: boolean;
}

function PasswordField({ creatingAccount, value, onChange, busy, disabled }: PasswordFieldProps) {
  return (
    <>
      <label htmlFor="login-password" className="sr-only">
        Password
      </label>
      <Input
        id="login-password"
        type="password"
        name="password"
        autoComplete={creatingAccount ? 'new-password' : 'current-password'}
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder="Password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button type="submit" variant="primary" size="md" block disabled={disabled}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="size-4" aria-hidden="true" />
        )}
        {creatingAccount ? 'Create account' : 'Sign in with password'}
      </Button>
    </>
  );
}

const SOCIAL_LABELS = {
  google: { label: 'Continue with Google', Mark: GoogleMark },
  github: { label: 'Continue with GitHub', Mark: GithubMark },
} as const;

function SocialButtons({
  providers,
  disabled,
  onSelect,
}: {
  readonly providers: readonly string[];
  readonly disabled: boolean;
  readonly onSelect: (provider: 'google' | 'github') => void;
}) {
  const available = (['google', 'github'] as const).filter((provider) =>
    providers.includes(provider),
  );
  if (available.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {available.map((provider) => {
        const { label, Mark } = SOCIAL_LABELS[provider];
        return (
          <Button
            key={provider}
            variant="secondary"
            size="md"
            block
            disabled={disabled}
            onClick={() => {
              onSelect(provider);
            }}
          >
            <Mark className="size-4" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}

function ForgotPasswordButton({
  sending,
  disabled,
  onClick,
}: {
  readonly sending: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="self-start text-muted text-xs underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {sending ? 'Sending reset link...' : 'Forgot password?'}
    </button>
  );
}

interface OtpFieldsProps {
  readonly sent: boolean;
  readonly value: string;
  readonly pending: boolean;
  readonly onChange: (value: string) => void;
  readonly onResend: () => void;
  readonly onChangeEmail: () => void;
}

function OtpFields({ sent, value, pending, onChange, onResend, onChangeEmail }: OtpFieldsProps) {
  if (!sent) return null;
  return (
    <>
      <label htmlFor="login-otp" className="sr-only">
        Sign in code
      </label>
      <Input
        id="login-otp"
        type="text"
        name="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        minLength={6}
        maxLength={6}
        pattern="[0-9]{6}"
        placeholder="6-digit code"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="text-muted underline-offset-2 hover:underline"
          disabled={pending}
          onClick={onResend}
        >
          Resend code
        </button>
        <button
          type="button"
          className="text-muted underline-offset-2 hover:underline"
          disabled={pending}
          onClick={onChangeEmail}
        >
          Use another email
        </button>
      </div>
    </>
  );
}

function LoginFooter({
  passwordEnabled,
  creatingAccount,
  onToggleAccount,
}: {
  readonly passwordEnabled: boolean;
  readonly creatingAccount: boolean;
  readonly onToggleAccount: () => void;
}) {
  return (
    <>
      {passwordEnabled ? (
        <button
          type="button"
          className="text-center text-muted text-xs underline-offset-2 hover:underline"
          onClick={onToggleAccount}
        >
          {creatingAccount ? 'I already have an account' : 'Create an account with a password'}
        </button>
      ) : null}
      <p className="text-center text-2xs text-faint">
        {passwordEnabled
          ? 'Passkeys and email codes still work. Sessions expire after 30 days.'
          : 'Orbit never asks for a password. Sessions expire after 30 days.'}
      </p>
    </>
  );
}

export function LoginForm({
  providers,
  callbackUrl = DEFAULT_CALLBACK_URL,
  passwordEnabled = false,
}: LoginFormProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [otpSent, setOtpSent] = useState(false);

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
      window.location.assign(callbackUrl);
    });

  const signInWithSocial = (provider: 'google' | 'github') =>
    withPending(provider, async () => {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: callbackUrl,
        errorCallbackURL: '/login',
      });
      if (result.error) throw new Error(result.error.message ?? 'That provider is unavailable.');
    });

  const submitPassword = () =>
    withPending('password', async () => {
      const result = creatingAccount
        ? await authClient.signUp.email({ email, password, name, callbackURL: callbackUrl })
        : await authClient.signIn.email({ email, password, callbackURL: callbackUrl });
      if (result.error) throw new Error(result.error.message ?? 'Check your details and retry.');
      window.location.assign(callbackUrl);
    });

  const sendOtp = () =>
    withPending('otp-send', async () => {
      const input = signInCodeRequestSchema.parse({ email });
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: input.email,
        type: 'sign-in',
      });
      if (result.error) throw new Error(result.error.message ?? 'Could not send the code.');
      setOtpSent(true);
      toast({
        title: 'Check your email',
        description: `A sign in code is on its way to ${email}.`,
      });
    });

  const verifyOtp = () =>
    withPending('otp-verify', async () => {
      const input = signInCodeVerifySchema.parse({ email, otp });
      const result = await authClient.signIn.emailOtp(input);
      if (result.error) throw new Error(result.error.message ?? 'That code is invalid or expired.');
      window.location.assign(callbackUrl);
    });

  const forgotPassword = () =>
    withPending('forgot', async () => {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      });
      if (result.error) throw new Error(result.error.message ?? 'Could not send the reset email.');
      toast({
        title: 'Check your email',
        description: `If ${email} has a password, a reset link is on its way.`,
      });
    });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (otpSent) {
      verifyOtp();
      return;
    }
    if (passwordEnabled) {
      submitPassword();
      return;
    }
    sendOtp();
  };
  const emailCodeButtonSubmits = !passwordEnabled || otpSent;

  return (
    <div className="flex w-full max-w-[22rem] flex-col gap-5">
      <div className="flex flex-col gap-1.5 text-center">
        <OrbitMark size={36} className="mx-auto" />
        <h1 className="font-medium text-text text-xl">Sign in to Orbit</h1>
        <p className="text-muted text-xs">
          {passwordEnabled
            ? 'Pick how you want in.'
            : 'Passwordless by design. Pick how you want in.'}
        </p>
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

      <SocialButtons
        providers={providers}
        disabled={pending !== null}
        onSelect={signInWithSocial}
      />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-2xs text-faint uppercase tracking-wide">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        {passwordEnabled && creatingAccount ? <NameField value={name} onChange={setName} /> : null}
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
          disabled={otpSent}
          onChange={(event) => setEmail(event.target.value)}
        />
        <OtpFields
          sent={otpSent}
          value={otp}
          pending={pending !== null}
          onChange={setOtp}
          onResend={() => {
            setOtp('');
            sendOtp();
          }}
          onChangeEmail={() => {
            setOtp('');
            setOtpSent(false);
          }}
        />
        {passwordEnabled && !otpSent ? (
          <PasswordField
            creatingAccount={creatingAccount}
            value={password}
            onChange={setPassword}
            busy={pending === 'password'}
            disabled={pending !== null || email.length === 0 || password.length === 0}
          />
        ) : null}
        {passwordEnabled && !creatingAccount && !otpSent ? (
          <ForgotPasswordButton
            sending={pending === 'forgot'}
            disabled={pending !== null || email.length === 0}
            onClick={() => {
              forgotPassword();
            }}
          />
        ) : null}
        <Button
          type={emailCodeButtonSubmits ? 'submit' : 'button'}
          variant="secondary"
          size="md"
          block
          disabled={pending !== null || email.length === 0 || (otpSent && otp.length !== 6)}
          {...(emailCodeButtonSubmits
            ? {}
            : {
                onClick: () => {
                  sendOtp();
                },
              })}
        >
          {pending === 'otp-send' || pending === 'otp-verify' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <MailCheck className="size-4" aria-hidden="true" />
          )}
          {otpSent ? 'Verify code' : 'Email me a code'}
        </Button>
      </form>

      <LoginFooter
        passwordEnabled={passwordEnabled}
        creatingAccount={creatingAccount}
        onToggleAccount={() => setCreatingAccount((current) => !current)}
      />
    </div>
  );
}
