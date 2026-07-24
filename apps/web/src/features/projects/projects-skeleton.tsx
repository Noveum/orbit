import { Skeleton } from '@/components/ui/skeleton.tsx';

const ROW_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

export function ProjectsSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-6 py-6" data-testid="projects-skeleton">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3 w-40" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-3 border-border border-b px-3 py-2.5">
          <Skeleton className="h-3 w-20" />
        </div>
        {ROW_KEYS.map((key) => (
          <div
            key={key}
            className="flex items-center gap-3 border-border border-b px-3 py-3 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-2.5 w-64" />
            </div>
            <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
            <Skeleton className="hidden size-5 rounded-full md:block" />
            <Skeleton className="hidden h-3 w-12 lg:block" />
            <Skeleton className="size-6 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6" data-testid="project-detail-skeleton">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full max-w-2xl" />
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {['lead', 'start', 'target', 'teams', 'progress'].map((key) => (
            <Skeleton key={key} className="h-4 w-24" />
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-28" />
            {['m1', 'm2', 'm3'].map((key) => (
              <Skeleton key={key} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="grid grid-cols-3 gap-2">
            {['scope', 'started', 'done'].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </div>
          <Skeleton className="h-33 w-full" />
        </div>
      </div>
    </div>
  );
}
