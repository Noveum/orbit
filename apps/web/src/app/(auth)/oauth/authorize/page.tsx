import { getMcpClient, listOrganizationsForUser, userHasPasskey } from '@orbit/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OrbitMark } from '@/components/brand/orbit-logo.tsx';
import { getSession } from '@/lib/auth/session.ts';
import { ConsentForm } from './consent-form.tsx';

export const metadata: Metadata = { title: 'Authorize' };
export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function ConsentShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <div className="mb-5 flex flex-col items-center gap-1.5 text-center">
          <OrbitMark size={36} />
          <h1 className="font-medium text-text text-xl">Connect to Orbit</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const consentCode = first(params['consent_code']);
  const clientId = first(params['client_id']);
  const scope = first(params['scope']) ?? '';

  if (consentCode === undefined || clientId === undefined) {
    return (
      <ConsentShell>
        <p className="text-center text-muted text-sm">
          This authorization link is invalid or has expired. Start the connection again from your AI
          client.
        </p>
      </ConsentShell>
    );
  }

  const session = await getSession();
  if (session === null) {
    const next = new URLSearchParams({
      consent_code: consentCode,
      client_id: clientId,
      scope,
    });
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${next.toString()}`)}`);
  }

  const [client, organizations, requirePasskey] = await Promise.all([
    getMcpClient(clientId),
    listOrganizationsForUser(session.user.id),
    userHasPasskey(session.user.id),
  ]);

  if (organizations.length === 0) {
    return (
      <ConsentShell>
        <p className="text-center text-muted text-sm">
          You are not a member of any workspace yet, so there is nothing to connect. Join or create
          a workspace first.
        </p>
      </ConsentShell>
    );
  }

  return (
    <ConsentShell>
      <ConsentForm
        consentCode={consentCode}
        clientId={clientId}
        clientName={client?.name ?? 'An MCP client'}
        scope={scope}
        scopes={scope.split(' ').filter((entry) => entry.length > 0)}
        organizations={organizations.map((entry) => ({
          id: entry.organization.id,
          name: entry.organization.name,
        }))}
        requirePasskey={requirePasskey}
        userEmail={session.user.email}
      />
    </ConsentShell>
  );
}
