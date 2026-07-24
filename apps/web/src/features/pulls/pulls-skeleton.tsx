import { Skeleton } from '@/components/ui/skeleton.tsx';

const GROUPS = [
  { id: 'first', rows: ['a', 'b', 'c'] },
  { id: 'second', rows: ['a', 'b'] },
];

export function PullsSkeleton() {
  return (
    <div className="flex min-h-full flex-col" data-testid="pulls-skeleton">
      <header className="flex items-center justify-between gap-3 border-border border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="size-5 rounded-full" />
        </div>
      </header>

      <div className="flex flex-col gap-6 p-5">
        {GROUPS.map((group) => (
          <section key={group.id} className="flex flex-col gap-1.5">
            <Skeleton className="mx-1 h-3 w-24" />
            <div className="flex flex-col overflow-hidden rounded-lg border border-border">
              {group.rows.map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-3 border-border border-b px-3 py-2.5 last:border-b-0"
                >
                  <Skeleton className="size-4 shrink-0 rounded-sm" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                  <Skeleton className="hidden h-3 w-14 sm:block" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
