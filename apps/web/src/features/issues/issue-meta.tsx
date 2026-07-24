'use client';

import { cn } from '@/lib/cn.ts';

export function shortDate(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface MetaChipProps {
  readonly label: string;
  readonly color?: string;
  readonly title: string;
  readonly className?: string;
}

export function MetaChip({ label, color, title, className }: MetaChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-sm border border-border px-1 text-2xs text-muted',
        className,
      )}
    >
      {color === undefined ? null : (
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      <span className="max-w-24 truncate">{label}</span>
    </span>
  );
}

export interface MetaDateProps {
  readonly value: string | null;
  readonly title: string;
  readonly className?: string;
}

export function MetaDate({ value, title, className }: MetaDateProps) {
  const label = shortDate(value);
  if (label === null) return null;
  return (
    <span data-numeric title={title} className={cn('shrink-0 text-2xs text-faint', className)}>
      {label}
    </span>
  );
}
