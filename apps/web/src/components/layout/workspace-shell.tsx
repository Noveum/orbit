'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { breadcrumbsFor } from '@/lib/breadcrumbs.ts';
import type { ShellTeam, ShellUser, ShellWorkspace } from '@/lib/navigation.ts';
import { AppShell } from './app-shell.tsx';

export interface WorkspaceShellProps {
  readonly workspace: ShellWorkspace;
  readonly workspaces: readonly ShellWorkspace[];
  readonly user: ShellUser;
  readonly teams: readonly ShellTeam[];
  readonly children: ReactNode;
}

export function WorkspaceShell({
  workspace,
  workspaces,
  user,
  teams,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  return (
    <AppShell
      workspace={workspace}
      workspaces={workspaces}
      user={user}
      teams={teams}
      breadcrumbs={breadcrumbsFor(pathname, workspace.name)}
    >
      {children}
    </AppShell>
  );
}
