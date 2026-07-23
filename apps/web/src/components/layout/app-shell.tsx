'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { CommandPalette } from '@/components/command-palette.tsx';
import { ShortcutsOverlay } from '@/components/shortcuts-overlay.tsx';
import { overlayClassName } from '@/components/ui/dialog.tsx';
import {
  buildNavigation,
  type ShellTeam,
  type ShellUser,
  type ShellWorkspace,
} from '@/lib/navigation.ts';
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query.ts';
import { Sidebar } from './sidebar.tsx';
import type { Breadcrumb } from './top-bar.tsx';
import { TopBar } from './top-bar.tsx';

export interface AppShellProps {
  readonly workspace: ShellWorkspace;
  readonly workspaces: readonly ShellWorkspace[];
  readonly user: ShellUser;
  readonly teams: readonly ShellTeam[];
  readonly inboxCount?: number;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function AppShell({
  workspace,
  workspaces,
  user,
  teams,
  inboxCount = 0,
  breadcrumbs,
  actions,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPath, setDrawerPath] = useState(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const sections = useMemo(() => buildNavigation(teams, inboxCount), [teams, inboxCount]);

  const toggleSidebar = useCallback(() => {
    if (isDesktop) setCollapsed((value) => !value);
    else setDrawerOpen((value) => !value);
  }, [isDesktop]);

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  const sidebar = (onNavigate?: () => void) => (
    <Sidebar
      workspace={workspace}
      workspaces={workspaces}
      user={user}
      sections={sections}
      collapsed={isDesktop ? collapsed : false}
      onToggleCollapsed={toggleSidebar}
      onOpenPalette={() => setPaletteOpen(true)}
      {...(onNavigate === undefined ? {} : { onNavigate })}
    />
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      <aside
        className={
          collapsed
            ? 'hidden w-[var(--sidebar-width-collapsed)] shrink-0 lg:block'
            : 'hidden w-[var(--sidebar-width)] shrink-0 lg:block'
        }
      >
        {sidebar()}
      </aside>

      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={`${overlayClassName} lg:hidden`} />
          <DialogPrimitive.Content
            aria-label="Navigation"
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-[min(17rem,85vw)] outline-none data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            {sidebar(() => setDrawerOpen(false))}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          breadcrumbs={breadcrumbs}
          onOpenDrawer={() => setDrawerOpen(true)}
          {...(actions === undefined ? {} : { actions })}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sections={sections}
        onToggleSidebar={toggleSidebar}
        onShowShortcuts={openShortcuts}
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
