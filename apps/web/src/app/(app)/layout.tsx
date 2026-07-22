import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/layout/workspace-shell.tsx';
import { resolveMembership } from '@/lib/auth/principal.ts';
import { requireSession } from '@/lib/auth/session.ts';
import type { ShellTeam } from '@/lib/navigation.ts';
import { WorkspaceRealtime } from '@/lib/realtime/provider.tsx';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

const DEFAULT_REALTIME_URL = 'ws://localhost:3100';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const membership = await resolveMembership(
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );

  const teams: ShellTeam[] =
    membership === null ? [] : await listTeamsForPrincipal(membership.principal);

  const shell = (
    <WorkspaceShell
      workspace={{
        name: membership?.organizationName ?? 'Orbit',
        slug: membership?.organizationSlug ?? 'orbit',
      }}
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
      url={process.env['NEXT_PUBLIC_REALTIME_URL'] ?? DEFAULT_REALTIME_URL}
      token={session.session.token}
      userId={membership.principal.userId}
      organizationId={membership.principal.organizationId}
      teamIds={teams.map((team) => team.id)}
    >
      {shell}
    </WorkspaceRealtime>
  );
}
