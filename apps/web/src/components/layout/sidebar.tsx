'use client';

import { PanelLeft, Search, X } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd.tsx';
import { ScrollArea } from '@/components/ui/scroll-area.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import type { NavSection, ShellUser, ShellWorkspace } from '@/lib/navigation.ts';
import { NavItem } from './nav-item.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

export interface SidebarProps {
  readonly workspace: ShellWorkspace;
  readonly workspaces: readonly ShellWorkspace[];
  readonly user: ShellUser;
  readonly sections: readonly NavSection[];
  readonly collapsed: boolean;
  readonly touch: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onOpenPalette: () => void;
  readonly onNavigate: (() => void) | null;
}

export function Sidebar({
  workspace,
  workspaces,
  user,
  sections,
  collapsed,
  touch,
  onToggleCollapsed,
  onOpenPalette,
  onNavigate,
}: SidebarProps) {
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
        <nav
          aria-label="Workspace"
          className="flex flex-col gap-4 px-2 pb-4 3xl:gap-5 3xl:px-3 3xl:pb-6"
        >
          {sections.map((section) => (
            <div key={section.id} className="flex flex-col gap-0.5">
              {section.title !== undefined && !collapsed ? (
                <p className="px-2 pt-1 pb-1 font-medium text-2xs text-faint uppercase tracking-wide">
                  {section.title}
                </p>
              ) : null}
              {section.links.map((link) => (
                <NavItem
                  key={link.href}
                  link={link}
                  collapsed={collapsed}
                  touch={touch}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
}
