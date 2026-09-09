import { can } from '@orbit/shared/policy';
import type { ReactNode } from 'react';
import { SettingsShell } from '@/features/settings/settings-shell.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { passwordAuthEnabled } from '@/lib/auth/server.ts';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const { principal } = await pageContext();
  const canManageAi = can(principal, 'ai:manage');

  return (
    <SettingsShell passwordEnabled={passwordAuthEnabled} canManageAi={canManageAi}>
      {children}
    </SettingsShell>
  );
}
