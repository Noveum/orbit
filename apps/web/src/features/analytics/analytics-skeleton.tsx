import { Skeleton } from '@/components/ui/skeleton.tsx';

function Card({ children }: { readonly children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {children}
    </section>
  );
}

function BarChartSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-12" />
      </div>
      <div className="flex flex-col gap-1.5">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <div key={key} className="grid grid-cols-[minmax(4rem,8rem)_1fr_auto] items-center gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6" data-testid="analytics-skeleton">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
        <Skeleton className="h-8 w-full max-w-md rounded-md" />
      </header>

      <Card>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-33 w-full" />
        <div className="flex justify-between">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {['assignee', 'project', 'label', 'estimate'].map((key) => (
          <Card key={key}>
            <BarChartSkeleton />
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-7 w-24 rounded-md" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-full" />
          {['r1', 'r2', 'r3', 'r4', 'r5'].map((key) => (
            <Skeleton key={key} className="h-5 w-full" />
          ))}
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </section>
    </div>
  );
}
