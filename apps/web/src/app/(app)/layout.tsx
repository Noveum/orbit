import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/layout/workspace-shell.tsx';
import { resolveMembership } from '@/lib/auth/principal.ts';
import { requireSession } from '@/lib/auth/session.ts';
import type { ShellTeam } from '@/lib/navigation.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const membership = await resolveMembership(
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );

  const teams: ShellTeam[] =
    membership === null ? [] : await listTeamsForPrincipal(membership.principal);

  return (
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
}
