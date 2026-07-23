'use client';

import { Menu, PanelRight, SlidersHorizontal } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';

export interface Breadcrumb {
  readonly label: string;
  readonly href?: string;
}

export const contentWidthClassName =
  'mx-auto w-full max-w-page 3xl:max-w-[110rem] 4xl:max-w-[120rem]';

export interface TopBarProps {
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly actions?: ReactNode;
  readonly onOpenDrawer: () => void;
  readonly panelOpen: boolean | null;
  readonly onTogglePanel: () => void;
}

export function TopBar({
  breadcrumbs,
  actions,
  onOpenDrawer,
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
                    <span className={last ? 'font-medium text-text' : 'text-muted'}>
                      {crumb.label}
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {actions}
          <Tooltip label="Display options" side="bottom">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Display options"
              className="size-11 px-0 lg:size-7"
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </Tooltip>
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
