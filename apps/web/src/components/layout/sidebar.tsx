'use client';

import { PanelLeft, Search, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Kbd } from '@/components/ui/kbd.tsx';
import { ScrollArea } from '@/components/ui/scroll-area.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import type { NavLink, ShellUser, ShellWorkspace, SidebarNav } from '@/lib/navigation.ts';
import { useSidebarDisclosure } from '@/lib/use-sidebar-disclosure.ts';
import { NavItem } from './nav-item.tsx';
import { SidebarSection } from './sidebar-section.tsx';
import { SidebarTeam } from './sidebar-team.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

export interface SidebarProps {
  readonly workspace: ShellWorkspace;
  readonly workspaces: readonly ShellWorkspace[];
  readonly user: ShellUser;
  readonly nav: SidebarNav;
  readonly collapsed: boolean;
  readonly touch?: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onOpenPalette: () => void;
  readonly onNavigate?: (() => void) | null;
}

function activeTeamKey(pathname: string): string | null {
  if (!pathname.startsWith('/team/')) return null;
  return pathname.split('/')[2]?.toLowerCase() ?? null;
}

export function Sidebar({
  workspace,
  workspaces,
  user,
  nav,
  collapsed,
  touch = false,
  onToggleCollapsed,
  onOpenPalette,
  onNavigate = null,
}: SidebarProps) {
  const pathname = usePathname();
  const disclosure = useSidebarDisclosure();
  const currentTeam = activeTeamKey(pathname);

  const toggle = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-label={touch ? 'Close navigation' : 'Toggle sidebar'}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md text-faint',
        'transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text',
        touch ? 'size-11' : 'size-7 3xl:size-8',
      )}
    >
      {touch ? (
        <X className="size-5" aria-hidden="true" />
      ) : (
        <PanelLeft className="size-4" aria-hidden="true" />
      )}
    </button>
  );

  const renderLink = (link: NavLink) => (
    <NavItem
      key={link.href}
      link={link}
      collapsed={collapsed}
      touch={touch}
      onNavigate={onNavigate}
    />
  );

  const teams = nav.teams.map((team) => {
    const fallbackOpen = team.key.toLowerCase() === currentTeam;
    return (
      <SidebarTeam
        key={team.id}
        team={team}
        collapsed={collapsed}
        touch={touch}
        open={disclosure.isOpen(`team:${team.id}`, fallbackOpen)}
        onToggle={() => disclosure.toggle(`team:${team.id}`, fallbackOpen)}
        onNavigate={onNavigate}
      />
    );
  });

  return (
    <div className="flex h-full flex-col gap-1 border-border border-r bg-surface">
      <div className={cn('flex items-center gap-1 p-2 3xl:p-3', collapsed && 'flex-col')}>
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher
            workspace={workspace}
            workspaces={workspaces}
            user={user}
            collapsed={collapsed}
            touch={touch}
          />
        </div>
        {touch ? (
          toggle
        ) : (
          <Tooltip label="Toggle sidebar" shortcut={['[']} side="bottom">
            {toggle}
          </Tooltip>
        )}
      </div>

      <div className="px-2 pb-1 3xl:px-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-dense text-faint',
            'transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:text-muted',
            touch ? 'h-11' : 'h-7 3xl:h-8',
            collapsed && 'justify-center px-0',
          )}
        >
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          {collapsed ? null : (
            <>
              <span className="flex-1 text-left">Search</span>
              {touch ? null : <Kbd keys={['mod', 'k']} />}
            </>
          )}
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {collapsed ? (
          <nav
            aria-label="Workspace"
            className="flex flex-col items-stretch gap-0.5 px-2 pb-4 3xl:px-3 3xl:pb-6"
          >
            {nav.personal.map(renderLink)}
            <div className="my-1 h-px bg-border" aria-hidden="true" />
            {nav.workspace.links.map(renderLink)}
            {teams.length > 0 ? (
              <>
                <div className="my-1 h-px bg-border" aria-hidden="true" />
                {teams}
              </>
            ) : null}
          </nav>
        ) : (
          <nav
            aria-label="Workspace"
            className="flex flex-col gap-3 px-2 pb-4 3xl:gap-4 3xl:px-3 3xl:pb-6"
          >
            <div className="flex flex-col gap-0.5">{nav.personal.map(renderLink)}</div>

            <SidebarSection
              title={nav.workspace.title}
              open={disclosure.isOpen('section:workspace', true)}
              onToggle={() => disclosure.toggle('section:workspace', true)}
            >
              {nav.workspace.links.map(renderLink)}
            </SidebarSection>

            {teams.length > 0 ? (
              <SidebarSection
                title="Teams"
                open={disclosure.isOpen('section:teams', true)}
                onToggle={() => disclosure.toggle('section:teams', true)}
              >
                {teams}
              </SidebarSection>
            ) : null}
          </nav>
        )}
      </ScrollArea>
    </div>
  );
}
