import Link from 'next/link';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';

export const SPRINT_TABS = ['board', 'list', 'planning', 'insights', 'retro'] as const;
export type SprintTab = (typeof SPRINT_TABS)[number];

const LABELS: Record<SprintTab, string> = {
  board: 'Board',
  list: 'List',
  planning: 'Planning',
  insights: 'Insights',
  retro: 'Retro',
};

export function parseSprintTab(value: string | undefined): SprintTab {
  return SPRINT_TABS.find((tab) => tab === value) ?? 'board';
}

export function sprintTabHref(base: string, tab: SprintTab): string {
  if (tab === 'board') return base;
  return `${base}${base.includes('?') ? '&' : '?'}tab=${tab}`;
}

export function SprintTabs({
  base,
  active,
  available,
}: {
  readonly base: string;
  readonly active: SprintTab;
  readonly available: readonly SprintTab[];
}): ReactElement {
  return (
    <nav
      className="flex items-center gap-0.5 border-border border-b"
      aria-label="Sprint views"
      data-testid="sprint-tabs"
    >
      {available.map((tab) => (
        <Link
          key={tab}
          href={sprintTabHref(base, tab)}
          data-testid={`sprint-tab-${tab}`}
          aria-current={tab === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-1.5 text-dense outline-none',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
            tab === active
              ? 'border-accent text-text'
              : cn('border-transparent text-muted', rowHover),
          )}
        >
          {LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
