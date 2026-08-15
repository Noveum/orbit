'use client';

import { ANALYTICS_LENSES, type AnalyticsLens } from '@orbit/shared/validators';
import { useRef } from 'react';
import { cn } from '@/lib/cn.ts';

const LABELS: Record<AnalyticsLens, string> = {
  overview: 'Overview',
  sprints: 'Sprints',
  projects: 'Projects',
  people: 'People',
  insights: 'Insights',
};

export function AnalyticsTabs({
  value,
  onChange,
}: {
  readonly value: AnalyticsLens;
  readonly onChange: (lens: AnalyticsLens) => void;
}) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (index: number, key: string) => {
    let next: number;
    if (key === 'ArrowRight') next = (index + 1) % ANALYTICS_LENSES.length;
    else if (key === 'ArrowLeft')
      next = (index - 1 + ANALYTICS_LENSES.length) % ANALYTICS_LENSES.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = ANALYTICS_LENSES.length - 1;
    else return;
    const lens = ANALYTICS_LENSES[next];
    if (lens === undefined) return;
    onChange(lens);
    tabs.current[next]?.focus();
  };

  return (
    <div aria-label="Analytics views" className="flex min-w-max gap-1" role="tablist">
      {ANALYTICS_LENSES.map((lens, index) => (
        <button
          aria-controls={`analytics-panel-${lens}`}
          aria-selected={value === lens}
          className={cn(
            'relative h-8 rounded-md px-3 font-medium text-xs outline-none transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
            value === lens
              ? 'bg-surface-2 text-text'
              : 'text-muted hover:bg-surface-2 hover:text-text',
          )}
          id={`analytics-tab-${lens}`}
          key={lens}
          onClick={() => onChange(lens)}
          onKeyDown={(event) => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            move(index, event.key);
          }}
          ref={(element) => {
            tabs.current[index] = element;
          }}
          role="tab"
          tabIndex={value === lens ? 0 : -1}
          type="button"
        >
          {LABELS[lens]}
        </button>
      ))}
    </div>
  );
}
