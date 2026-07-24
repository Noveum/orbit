import { Skeleton } from '@/components/ui/skeleton.tsx';

export function DocPaneSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="doc-pane-skeleton">
      <div className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-3">
        <span className="flex-1" />
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
      <div className="mx-auto flex w-full max-w-[45rem] flex-col gap-4 px-6 py-10">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export function NewDocSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-[45rem] flex-col gap-4 px-6 py-10"
      data-testid="new-doc-skeleton"
    >
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
