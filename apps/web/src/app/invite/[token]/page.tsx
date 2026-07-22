import { db, eq, schema } from '@orbit/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { InviteAccept } from '@/features/settings/invite-accept.tsx';
import { getSession } from '@/lib/auth/session.ts';

export const metadata: Metadata = { title: 'Join a workspace' };

interface InviteRecord {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: Date;
  readonly organizationName: string;
}

async function loadInvite(token: string): Promise<InviteRecord | null> {
  const [row] = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      organizationName: schema.organization.name,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .where(eq(schema.invitation.id, token))
    .limit(1);
  return row ?? null;
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-pop">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent font-semibold text-accent-contrast text-base">
          O
        </span>
        <h1 className="font-medium text-text text-xl">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await loadInvite(token);

  if (invite === null) {
    return (
      <Shell title="That invite is not valid">
        <p className="text-muted text-xs">
          The link may have been mistyped. Ask whoever invited you to send a fresh one.
        </p>
      </Shell>
    );
  }

  if (invite.status === 'revoked') {
    return (
      <Shell title="This invite was revoked">
        <p className="text-muted text-xs">
          An admin of {invite.organizationName} cancelled this invite. Ask them to send a new one.
        </p>
      </Shell>
    );
  }

  if (invite.status === 'accepted') {
    return (
      <Shell title="This invite was already used">
        <p className="text-muted text-xs">
          You are already part of {invite.organizationName}. Sign in to keep going.
        </p>
        <Button variant="primary" size="md" block asChild>
          <Link href="/my-issues">Open Orbit</Link>
        </Button>
      </Shell>
    );
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    return (
      <Shell title="This invite expired">
        <p className="text-muted text-xs">
          Invites last 14 days. Ask an admin of {invite.organizationName} to resend it.
        </p>
      </Shell>
    );
  }

  const session = await getSession();

  if (session === null) {
    return (
      <Shell title={`Join ${invite.organizationName}`}>
        <p className="text-muted text-xs">
          This invite was sent to <span className="text-text">{invite.email}</span> as a{' '}
          {invite.role}. Sign in with that address and you will land back here.
        </p>
        <Button variant="primary" size="md" block asChild>
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
            Sign in to continue
          </Link>
        </Button>
      </Shell>
    );
  }

  if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell title="Wrong account">
        <p className="text-muted text-xs">
          This invite was sent to <span className="text-text">{invite.email}</span>, but you are
          signed in as <span className="text-text">{session.user.email}</span>. Sign out and sign
          back in with the invited address.
        </p>
        <Button variant="secondary" size="md" block asChild>
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Switch account</Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title={`Join ${invite.organizationName}`}>
      <p className="text-muted text-xs">
        You were invited as a {invite.role}. Accepting adds you to the workspace right away.
      </p>
      <InviteAccept token={token} organizationName={invite.organizationName} />
    </Shell>
  );
}
