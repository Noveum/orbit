import { getOnboardingStatus, listOrganizationsForUser } from '@orbit/core';
import { HydrationBoundary } from '@tanstack/react-query';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/layout/workspace-shell.tsx';
import { IssueWorkspaceProvider } from '@/features/issues/workspace-provider.tsx';
import { resolveMembership } from '@/lib/auth/principal.ts';
import { requireSession } from '@/lib/auth/session.ts';
import type { ShellTeam, ShellWorkspace } from '@/lib/navigation.ts';
import { WorkspaceCachePersistence } from '@/lib/query/persistence.tsx';
import { dehydratedWorkspace } from '@/lib/query/prefetch.ts';
import { WorkspaceRealtime } from '@/lib/realtime/provider.tsx';
import { configuredRealtimeUrl } from '@/lib/realtime/url.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

function realtimeUrl(): string {
  return configuredRealtimeUrl();
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  const [onboarding, membership, organizations] = await Promise.all([
    getOnboardingStatus(session.user.id),
    resolveMembership(session.user.id, session.session.activeOrganizationId ?? null),
    listOrganizationsForUser(session.user.id),
  ]);

  if (!onboarding.completed) redirect('/onboarding');

  const [teams, dehydrated] = await Promise.all([
    membership === null
      ? Promise.resolve<ShellTeam[]>([])
      : listTeamsForPrincipal(membership.principal),
    membership === null ? Promise.resolve(null) : dehydratedWorkspace(membership.principal),
  ]);

  const workspaces: ShellWorkspace[] = organizations.map((row) => ({
    id: row.organization.id,
    name: row.organization.name,
    slug: row.organization.slug,
  }));

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

  if (membership === null || dehydrated === null) return shell;

  return (
    <HydrationBoundary state={dehydrated}>
      <WorkspaceCachePersistence
        userId={membership.principal.userId}
        organizationId={membership.principal.organizationId}
      />
      <WorkspaceRealtime
        url={realtimeUrl()}
        userId={membership.principal.userId}
        organizationId={membership.principal.organizationId}
        teamIds={teams.map((team) => team.id)}
      >
        <IssueWorkspaceProvider>{shell}</IssueWorkspaceProvider>
      </WorkspaceRealtime>
    </HydrationBoundary>
  );
}
