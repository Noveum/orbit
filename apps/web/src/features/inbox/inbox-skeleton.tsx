import { Skeleton } from '@/components/ui/skeleton.tsx';

const TABS = ['all', 'unread', 'mentions', 'pulls'];

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

export function InboxSkeleton() {
  return (
    <div className="flex min-h-full flex-col" data-testid="inbox-skeleton">
      <header className="flex flex-col gap-3 border-border border-b px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="hidden h-4 w-64 sm:block" />
        </div>
        <nav className="flex items-center gap-1" aria-label="Inbox filters">
          {TABS.map((tab) => (
            <Skeleton key={tab} className="h-6 w-20 rounded-md" />
          ))}
        </nav>
      </header>

      <div className="grid flex-1 grid-cols-1 md:grid-cols-[22rem_minmax(0,1fr)]">
        <ul className="flex flex-col border-border border-r">
          {ROWS.map((row) => (
            <li key={row} className="flex items-start gap-2.5 border-border border-b px-3 py-2.5">
              <Skeleton className="mt-1.5 size-1.5 shrink-0 rounded-full" />
              <Skeleton className="mt-0.5 size-3.5 shrink-0 rounded-sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Skeleton className="h-3 w-48 max-w-full" />
                <Skeleton className="h-2 w-28" />
              </div>
            </li>
          ))}
        </ul>

        <section className="hidden flex-col gap-3 p-5 md:flex">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-2 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-3 w-24" />
        </section>
      </div>
    </div>
  );
}
