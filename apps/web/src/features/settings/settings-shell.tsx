'use client';

import { PanelLeft } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { SettingsSidebar } from './settings-sidebar.tsx';
import { type SettingsNavControl, SettingsNavProvider } from './use-settings-nav.ts';

export interface SettingsShellProps {
  readonly passwordEnabled: boolean;
  readonly canManageAi?: boolean;
  readonly children: ReactNode;
}

export function SettingsShell({
  passwordEnabled,
  canManageAi = true,
  children,
}: SettingsShellProps) {
  const [open, setOpen] = useState(false);

  const control = useMemo<SettingsNavControl>(
    () => ({
      open,
      toggle: () => setOpen((value) => !value),
      close: () => setOpen(false),
    }),
    [open],
  );

  return (
    <SettingsNavProvider value={control}>
      <div className="flex h-full min-h-0 flex-col" data-testid="settings-workspace">
        <header className="flex shrink-0 items-start gap-2 border-border border-b px-6 py-6">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Toggle settings sections"
            data-testid="toggle-settings-sections"
            className="mt-0.5 size-7 shrink-0 px-0 lg:hidden"
            onClick={control.toggle}
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-semibold text-xl text-text">Settings</h1>
            <p className="text-muted text-xs">
              Your account and how you sign in, then the workspace, its people, teams, and
              notifications.
            </p>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <SettingsSidebar passwordEnabled={passwordEnabled} canManageAi={canManageAi} />
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 3xl:max-w-4xl">
              {children}
            </div>
          </div>
        </div>
      </div>
    </SettingsNavProvider>
  );
}
