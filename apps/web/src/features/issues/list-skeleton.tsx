'use client';

import { Skeleton } from '@/components/ui/skeleton.tsx';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { HEADER_HEIGHT } from './issue-list.tsx';
import { ROW_HEIGHT } from './issue-row.tsx';

const SKELETON_GROUPS = [
  { id: 'first', rows: ['a', 'b', 'c', 'd', 'e'], width: 'w-64' },
  { id: 'second', rows: ['a', 'b', 'c', 'd'], width: 'w-80' },
  { id: 'third', rows: ['a', 'b', 'c'], width: 'w-52' },
];

export function ListSkeleton({ layout }: { layout: ViewLayoutMode }) {
  if (layout === 'board') {
    return (
      <div className="flex h-full min-h-0 gap-3 overflow-hidden p-3" data-testid="list-skeleton">
        {SKELETON_GROUPS.map((group) => (
          <section
            key={group.id}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-surface-2/60 p-2"
          >
            <div className="flex items-center gap-2 px-0.5 py-1">
              <Skeleton className="size-3 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            {group.rows.map((row) => (
              <Skeleton key={row} className="h-[4.75rem] w-full rounded-lg" />
            ))}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="list-skeleton">
      {SKELETON_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col">
          <div
            className="flex items-center gap-2 border-border border-b bg-surface-2/60 px-3"
            style={{ height: HEADER_HEIGHT }}
          >
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          {group.rows.map((row) => (
            <div key={row} className="flex items-center gap-2 px-3" style={{ height: ROW_HEIGHT }}>
              <Skeleton className="size-3.5 rounded-sm" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className={`h-3 ${group.width}`} />
              <Skeleton className="ml-auto size-4.5 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
