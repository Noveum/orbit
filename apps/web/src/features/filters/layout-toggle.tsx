'use client';

import { Columns3, List } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import type { ViewLayoutMode } from './view-config.ts';

const OPTIONS: readonly { mode: ViewLayoutMode; label: string; icon: typeof List }[] = [
  { mode: 'list', label: 'List', icon: List },
  { mode: 'board', label: 'Board', icon: Columns3 },
];

export interface LayoutToggleProps {
  readonly layout: ViewLayoutMode;
  readonly onChange: (next: ViewLayoutMode) => void;
}

export function LayoutToggle({ layout, onChange }: LayoutToggleProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={layout === option.mode}
          aria-label={`Show as a ${option.label.toLowerCase()}`}
          data-testid={`layout-${option.mode}`}
          onClick={() => onChange(option.mode)}
          className={cn(
            'flex h-6 items-center gap-1.5 rounded-md px-2 text-2xs',
            'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            layout === option.mode ? 'bg-surface-2 text-text' : 'text-faint hover:text-muted',
          )}
        >
          <option.icon className="size-3.5" aria-hidden="true" />
          {option.label}
        </button>
      ))}
    </div>
  );
}
