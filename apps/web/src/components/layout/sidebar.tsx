'use client';

import { PanelLeft, Search } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd.tsx';
import { ScrollArea } from '@/components/ui/scroll-area.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import type { NavSection, ShellUser, ShellWorkspace } from '@/lib/navigation.ts';
import { NavItem } from './nav-item.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

export interface SidebarProps {
  readonly workspace: ShellWorkspace;
  readonly user: ShellUser;
  readonly sections: readonly NavSection[];
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onOpenPalette: () => void;
  readonly onNavigate?: () => void;
}

export function Sidebar({
  workspace,
  user,
  sections,
  collapsed,
  onToggleCollapsed,
  onOpenPalette,
  onNavigate,
}: SidebarProps) {
  return (
    <div className="flex h-full flex-col gap-1 border-border border-r bg-surface">
      <div className={cn('flex items-center gap-1 p-2', collapsed && 'flex-col')}>
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher workspace={workspace} user={user} collapsed={collapsed} />
        </div>
        <Tooltip label="Toggle sidebar" shortcut={['[']} side="bottom">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Toggle sidebar"
            className="hidden size-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text lg:flex"
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={onOpenPalette}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-dense text-faint sm:h-7',
            'transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:text-muted',
            collapsed && 'justify-center px-0',
          )}
        >
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          {collapsed ? null : (
            <>
              <span className="flex-1 text-left">Search</span>
              <Kbd keys={['mod', 'k']} />
            </>
          )}
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Workspace" className="flex flex-col gap-4 px-2 pb-4">
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
                  {...(onNavigate === undefined ? {} : { onNavigate })}
                />
              ))}
            </div>
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
}
