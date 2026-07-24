'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { CommandPalette } from '@/components/command-palette.tsx';
import { ShortcutsOverlay } from '@/components/shortcuts-overlay.tsx';
import { overlayClassName } from '@/components/ui/dialog.tsx';
import { ViewControlsHost } from '@/features/filters/view-controls.tsx';
import { cn } from '@/lib/cn.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import {
  buildNavigation,
  type ShellTeam,
  type ShellUser,
  type ShellWorkspace,
} from '@/lib/navigation.ts';
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query.ts';
import { Sidebar } from './sidebar.tsx';
import type { Breadcrumb } from './top-bar.tsx';
import { contentWidthClassName, TopBar } from './top-bar.tsx';

export interface AppShellProps {
  readonly workspace: ShellWorkspace;
  readonly workspaces: readonly ShellWorkspace[];
  readonly user: ShellUser;
  readonly teams: readonly ShellTeam[];
  readonly inboxCount?: number;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly actions?: ReactNode;
  readonly panel?: ReactNode;
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
  panel,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [drawerPath, setDrawerPath] = useState(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const sections = useMemo(() => buildNavigation(teams, inboxCount), [teams, inboxCount]);

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  const toggleSidebar = useCallback(() => {
    if (isDesktop) setCollapsed((value) => !value);
    else setDrawerOpen((value) => !value);
  }, [isDesktop]);

  const togglePanel = useCallback(() => setPanelOpen((value) => !value), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  useHotkey(']', togglePanel, {
    label: 'Toggle right panel',
    section: 'View',
    enabled: panel !== undefined,
  });

  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  const sidebar = (touch: boolean, onNavigate: (() => void) | null) => (
    <Sidebar
      workspace={workspace}
      workspaces={workspaces}
      user={user}
      sections={sections}
      collapsed={!touch && collapsed}
      touch={touch}
      onToggleCollapsed={toggleSidebar}
      onOpenPalette={() => setPaletteOpen(true)}
      onNavigate={onNavigate}
    />
  );

  return (
    <ViewControlsHost>
      <div
        className={cn(
          'flex h-dvh w-full overflow-hidden bg-bg',
          '3xl:[--sidebar-width:17rem] 4xl:[--sidebar-width:19rem]',
        )}
      >
        <aside
          className={
            collapsed
              ? 'hidden w-[var(--sidebar-width-collapsed)] shrink-0 lg:block'
              : 'hidden w-[var(--sidebar-width)] shrink-0 lg:block'
          }
        >
          {sidebar(false, null)}
        </aside>

        <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className={`${overlayClassName} lg:hidden`} />
            <DialogPrimitive.Content
              aria-label="Navigation"
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 w-[min(20rem,88vw)] outline-none data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in sm:w-[min(17rem,80vw)] lg:hidden"
            >
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              {sidebar(true, () => setDrawerOpen(false))}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            breadcrumbs={breadcrumbs}
            onOpenDrawer={() => setDrawerOpen(true)}
            panelOpen={panel === undefined ? null : panelOpen}
            onTogglePanel={togglePanel}
            {...(actions === undefined ? {} : { actions })}
          />
          <div className={cn(contentWidthClassName, 'flex min-h-0 flex-1')}>
            <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
            {panel === undefined || !panelOpen ? null : (
              <aside
                aria-label="Details"
                className="hidden w-80 shrink-0 overflow-y-auto border-border border-l bg-surface xl:block 3xl:w-96"
              >
                {panel}
              </aside>
            )}
          </div>
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
    </ViewControlsHost>
  );
}
