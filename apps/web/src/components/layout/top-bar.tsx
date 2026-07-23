'use client';

import { Menu } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle.tsx';
import { Button } from '@/components/ui/button.tsx';
import { TopBarDisplayMenu } from '@/features/filters/view-controls.tsx';

export interface Breadcrumb {
  readonly label: string;
  readonly href?: string;
}

export interface TopBarProps {
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly actions?: ReactNode;
  readonly onOpenDrawer: () => void;
}

export function TopBar({ breadcrumbs, actions, onOpenDrawer }: TopBarProps) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b bg-bg px-2 sm:px-3">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Open navigation"
        onClick={onOpenDrawer}
        className="size-9 px-0 lg:hidden"
      >
        <Menu className="size-4" aria-hidden="true" />
      </Button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-dense">
          {breadcrumbs.map((crumb, index) => (
            <Fragment key={crumb.label}>
              {index > 0 ? (
                <li aria-hidden="true" className="text-faint">
                  /
                </li>
              ) : null}
              <li className="min-w-0 truncate">
                <span
                  className={
                    index === breadcrumbs.length - 1 ? 'font-medium text-text' : 'text-muted'
                  }
                >
                  {crumb.label}
                </span>
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <TopBarDisplayMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
