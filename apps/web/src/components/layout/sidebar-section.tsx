'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Collapsible } from '@/components/ui/collapsible.tsx';
import { cn } from '@/lib/cn.ts';

export interface SidebarSectionProps {
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}

export function SidebarSection({ title, open, onToggle, children }: SidebarSectionProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'group flex w-full items-center gap-1 rounded-md px-2 pt-1 pb-1',
          'font-medium text-2xs text-faint uppercase tracking-wide',
          'transition-colors duration-[var(--duration-fast)] hover:text-muted',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-faint transition-transform duration-[var(--duration-fast)]',
            open && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      <Collapsible open={open} className="flex flex-col gap-0.5">
        {children}
      </Collapsible>
    </div>
  );
}
