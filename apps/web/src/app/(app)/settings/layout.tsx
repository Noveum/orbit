import type { ReactNode } from 'react';
import { SettingsNav } from '@/features/settings/settings-nav.tsx';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 3xl:max-w-5xl 4xl:max-w-6xl">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl text-text">Settings</h1>
        <p className="text-muted text-xs">
          Your account and how you sign in, then the workspace, its people, teams, and
          notifications.
        </p>
      </header>
      <div className="border-border border-b pb-4">
        <SettingsNav />
      </div>
      {children}
    </div>
  );
}
