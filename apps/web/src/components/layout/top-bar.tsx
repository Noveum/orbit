'use client';

import { Menu, PanelRight, Search } from 'lucide-react';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';

export interface Breadcrumb {
  readonly label: string;
  readonly href?: string;
}

export const contentWidthClassName = 'w-full';

export interface TopBarProps {
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly actions?: ReactNode;
  readonly onOpenDrawer: () => void;
  readonly onOpenSearch: () => void;
  readonly panelOpen: boolean | null;
  readonly onTogglePanel: () => void;
}

function SearchBox({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
        data-testid="top-bar-search"
        onClick={onOpen}
        className={cn(
          'hidden h-7 min-w-56 shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-2 text-left',
          'text-dense text-faint transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
          'hover:border-border-strong hover:text-muted md:flex',
        )}
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search</span>
        <Kbd keys={['mod', 'k']} className="opacity-70" />
      </button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Search"
        data-testid="top-bar-search-compact"
        onClick={onOpen}
        className="size-7 shrink-0 px-0 md:hidden"
      >
        <Search className="size-4" aria-hidden="true" />
      </Button>
    </>
  );
}

export function TopBar({
  breadcrumbs,
  actions,
  onOpenDrawer,
  onOpenSearch,
  panelOpen,
  onTogglePanel,
}: TopBarProps) {
  return (
    <header className="shrink-0 border-border border-b bg-bg">
      <div
        className={cn(
          contentWidthClassName,
          'flex h-12 items-center gap-1 px-2 sm:gap-2 sm:px-3',
          'lg:h-[var(--topbar-height)] 3xl:px-4',
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open navigation"
          onClick={onOpenDrawer}
          className="size-11 shrink-0 px-0 lg:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>

        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-dense">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <Fragment key={crumb.label}>
                  {index > 0 ? (
                    <li aria-hidden="true" className="hidden text-faint sm:block">
                      /
                    </li>
                  ) : null}
                  <li className={cn('min-w-0 truncate', last ? 'block' : 'hidden sm:block')}>
                    {crumb.href === undefined ? (
                      <span className={last ? 'font-medium text-text' : 'text-muted'}>
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className={cn('block truncate rounded-xs text-muted', tabHover)}
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <SearchBox onOpen={onOpenSearch} />
          {actions}
          {panelOpen === null ? null : (
            <Tooltip label="Toggle right panel" shortcut={[']']} side="bottom">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Toggle right panel"
                aria-pressed={panelOpen}
                onClick={onTogglePanel}
                className="hidden size-7 px-0 xl:inline-flex"
              >
                <PanelRight className="size-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
