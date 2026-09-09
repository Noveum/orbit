import { can } from '@orbit/shared/policy';
import type { ReactNode } from 'react';
import { SettingsShell } from '@/features/settings/settings-shell.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { passwordAuthEnabled } from '@/lib/auth/server.ts';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const { principal } = await pageContext({ allowDeleting: true });
  const canManageAi = can(principal, 'ai:manage');
  const canManageDeployment = can(principal, 'org:manage');

  return (
    <SettingsShell
      passwordEnabled={passwordAuthEnabled}
      canManageAi={canManageAi}
      canManageDeployment={canManageDeployment}
    >
      {children}
    </SettingsShell>
  );
}
