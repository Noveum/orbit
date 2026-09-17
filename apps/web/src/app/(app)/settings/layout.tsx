import { can } from '@orbit/shared/policy';
import type { ReactNode } from 'react';
import { SettingsShell } from '@/features/settings/settings-shell.tsx';
import { resolveMembership } from '@/lib/auth/principal.ts';
import { passwordAuthEnabled } from '@/lib/auth/server.ts';
import { requireSession } from '@/lib/auth/session.ts';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const membership = await resolveMembership(
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );

  const canManageAi =
    membership !== null &&
    membership.deletionRequestedAt === null &&
    can(membership.principal, 'ai:manage');

  return (
    <SettingsShell passwordEnabled={passwordAuthEnabled} canManageAi={canManageAi}>
      {children}
    </SettingsShell>
  );
}
