'use client';

import type { Measure } from '@orbit/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn.ts';

const OPTIONS: readonly { value: Measure; label: string }[] = [
  { value: 'issues', label: 'Issues' },
  { value: 'points', label: 'Points' },
];

export function MeasureToggle({ measure }: { readonly measure: Measure }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(next: Measure): void {
    if (next === measure) return;
    const query = new URLSearchParams(params.toString());
    query.set('measure', next);
    router.push(`${pathname}?${query.toString()}`);
  }

  return (
    <fieldset className="inline-flex rounded-md border border-border bg-surface p-0.5">
      <legend className="sr-only">Measure</legend>
      {OPTIONS.map((option) => {
        const active = option.value === measure;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => select(option.value)}
            className={cn(
              'rounded-sm px-2.5 py-1 font-medium text-xs transition-colors duration-[var(--duration-fast)]',
              active ? 'bg-accent text-accent-contrast' : 'text-muted hover:text-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
