import { Skeleton } from '@/components/ui/skeleton.tsx';

const ISSUE_GROUPS = [
  { id: 'group-a', rows: ['a', 'b', 'c', 'd'] },
  { id: 'group-b', rows: ['a', 'b', 'c'] },
];

const ASSIGNEES = ['first', 'second', 'third'];

const UPCOMING = ['first', 'second'];

const PANEL_IDS = ['primary', 'secondary'];

function CycleIssueListSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {ISSUE_GROUPS.map((group) => (
        <section key={group.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-4" />
          </div>
          <ul className="flex flex-col rounded-lg border border-border">
            {group.rows.map((row) => (
              <li
                key={row}
                className="flex items-center gap-3 border-border border-b px-3 py-1.5 last:border-b-0"
              >
                <Skeleton className="h-3 w-16 shrink-0" />
                <Skeleton className="h-3 min-w-0 flex-1" />
                <Skeleton className="size-4.5 shrink-0 rounded-full" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CycleAnalyticsSkeleton() {
  return (
    <aside className="flex flex-col gap-5 rounded-lg border border-border p-4">
      <div className="grid grid-cols-3 gap-2">
        {['scope', 'started', 'completed'].map((stat) => (
          <div key={stat} className="flex flex-col items-center gap-1">
            <Skeleton className="h-6 w-8" />
            <Skeleton className="h-2 w-12" />
          </div>
        ))}
      </div>
      <Skeleton className="h-36 w-full rounded-md" />
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-24" />
        {ASSIGNEES.map((assignee) => (
          <div key={assignee} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-2 w-8" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </aside>
  );
}

function CyclePanelSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-5 w-12 rounded-full" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <CycleIssueListSkeleton />
        <CycleAnalyticsSkeleton />
      </div>
      <section className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <ul className="flex flex-col gap-1.5">
          {UPCOMING.map((entry) => (
            <li
              key={entry}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-10 rounded-full" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-2 w-24" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function CycleSkeleton({ panels = 2 }: { readonly panels?: number }) {
  const ids = PANEL_IDS.slice(0, Math.max(1, panels));
  return (
    <div className="flex flex-col gap-10 px-6 py-6" data-testid="cycles-skeleton">
      <header className="flex flex-col gap-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </header>
      {ids.map((id) => (
        <CyclePanelSkeleton key={id} />
      ))}
    </div>
  );
}
