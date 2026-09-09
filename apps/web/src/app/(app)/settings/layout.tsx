import type { ReactNode } from 'react';
import { SettingsShell } from '@/features/settings/settings-shell.tsx';
import { passwordAuthEnabled } from '@/lib/auth/server.ts';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsShell passwordEnabled={passwordAuthEnabled}>{children}</SettingsShell>;
}
