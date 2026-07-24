import { Skeleton } from '@/components/ui/skeleton.tsx';

const PROPERTY_ROWS = ['status', 'priority', 'assignee', 'estimate', 'labels', 'project', 'cycle'];

const DESCRIPTION_LINES = ['a', 'b', 'c', 'd'];

function IssuePropertiesSkeleton() {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-0.5 border-border border-t p-3 lg:w-64 lg:border-t-0 lg:border-l">
      {PROPERTY_ROWS.map((row) => (
        <div key={row} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-2 pt-2">
            <Skeleton className="h-2 w-14" />
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </aside>
  );
}

export function IssueDetailSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" data-testid="issue-detail-skeleton">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="flex items-center gap-2 border-border border-b px-5 py-2.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="ml-auto h-6 w-24 rounded-md" />
        </header>

        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
          <Skeleton className="h-7 w-2/3" />
          <div className="flex flex-col gap-2">
            {DESCRIPTION_LINES.map((line) => (
              <Skeleton key={line} className="h-4 w-full" />
            ))}
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        </div>
      </div>

      <IssuePropertiesSkeleton />
    </div>
  );
}
