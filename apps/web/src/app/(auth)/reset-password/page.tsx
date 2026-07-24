import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ResetPasswordForm } from '@/components/auth/reset-password-form.tsx';
import { passwordAuthEnabled } from '@/lib/auth/server.ts';

export const metadata: Metadata = { title: 'Reset password' };

function tokenFrom(params: Record<string, string | string[] | undefined>): string | null {
  if (params['error'] === 'INVALID_TOKEN') return null;
  const token = params['token'];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!passwordAuthEnabled) redirect('/login');
  const token = tokenFrom(await searchParams);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
