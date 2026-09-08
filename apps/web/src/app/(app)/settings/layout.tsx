import { can } from '@orbit/shared/policy';
import type { ReactNode } from 'react';
import { SettingsShell } from '@/features/settings/settings-shell.tsx';
import { apiContext } from '@/lib/api/handler.ts';
import { passwordAuthEnabled } from '@/lib/auth/server.ts';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  let canManageAi = true;
  try {
    const { principal } = await apiContext();
    canManageAi = can(principal, 'ai:manage');
  } catch {
    canManageAi = false;
  }

  return (
    <SettingsShell passwordEnabled={passwordAuthEnabled} canManageAi={canManageAi}>
      {children}
    </SettingsShell>
  );
}
