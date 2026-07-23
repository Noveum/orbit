import { getOnboardingStatus, listOrganizationsForUser } from '@orbit/core';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/layout/workspace-shell.tsx';
import { IssueWorkspaceProvider } from '@/features/issues/workspace-provider.tsx';
import { resolveMembership } from '@/lib/auth/principal.ts';
import { requireSession } from '@/lib/auth/session.ts';
import type { ShellTeam, ShellWorkspace } from '@/lib/navigation.ts';
import { WorkspaceRealtime } from '@/lib/realtime/provider.tsx';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

const DEVELOPMENT_REALTIME_URL = 'ws://localhost:3100';

function realtimeUrl(): string {
  const configured = process.env['NEXT_PUBLIC_REALTIME_URL'];
  if (configured !== undefined && configured.length > 0) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_REALTIME_URL must be set so clients can reach the realtime server.',
    );
  }
  return DEVELOPMENT_REALTIME_URL;
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const onboarding = await getOnboardingStatus(session.user.id);
  if (!onboarding.completed) redirect('/onboarding');

  const membership = await resolveMembership(
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );

  const teams: ShellTeam[] =
    membership === null ? [] : await listTeamsForPrincipal(membership.principal);

  const workspaces: ShellWorkspace[] = (await listOrganizationsForUser(session.user.id)).map(
    (row) => ({
      id: row.organization.id,
      name: row.organization.name,
      slug: row.organization.slug,
    }),
  );

  const shell = (
    <WorkspaceShell
      workspace={{
        id: membership?.principal.organizationId ?? '',
        name: membership?.organizationName ?? 'Orbit',
        slug: membership?.organizationSlug ?? 'orbit',
      }}
      workspaces={workspaces}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
      teams={teams}
    >
      {children}
    </WorkspaceShell>
  );

  if (membership === null) return shell;

  return (
    <WorkspaceRealtime
      url={realtimeUrl()}
      token={session.session.token}
      userId={membership.principal.userId}
      organizationId={membership.principal.organizationId}
      teamIds={teams.map((team) => team.id)}
    >
      <IssueWorkspaceProvider>{shell}</IssueWorkspaceProvider>
    </WorkspaceRealtime>
  );
}
