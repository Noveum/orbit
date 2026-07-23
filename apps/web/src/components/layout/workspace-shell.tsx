'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ShellTeam, ShellUser, ShellWorkspace } from '@/lib/navigation.ts';
import { AppShell } from './app-shell.tsx';
import type { Breadcrumb } from './top-bar.tsx';

const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleize(segment: string): string {
  const words = segment.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function breadcrumbsFor(pathname: string, workspaceName: string): Breadcrumb[] {
  const segments = pathname
    .split('/')
    .filter((segment) => segment.length > 0 && !OPAQUE_ID.test(segment));
  if (segments.length === 0) return [{ label: workspaceName }];
  return [{ label: workspaceName }, ...segments.map((segment) => ({ label: titleize(segment) }))];
}

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
