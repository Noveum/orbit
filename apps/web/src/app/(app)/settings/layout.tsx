import type { ReactNode } from 'react';
import { SettingsNav } from '@/features/settings/settings-nav.tsx';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl text-text">Workspace settings</h1>
        <p className="text-muted text-xs">
          Manage the workspace, its people, teams, and how Orbit reaches you.
        </p>
      </header>
      <SettingsNav />
      {children}
    </div>
  );
}
