import { Skeleton } from '@/components/ui/skeleton.tsx';

const TREE_GROUPS = [
  { id: 'a', rows: ['a1', 'a2', 'a3', 'a4'] },
  { id: 'b', rows: ['b1', 'b2', 'b3'] },
  { id: 'c', rows: ['c1', 'c2'] },
];

function TreeSkeleton() {
  return (
    <div className="hidden h-full w-64 shrink-0 flex-col border-border border-r bg-surface lg:flex">
      <div className="border-border border-b p-2">
        <Skeleton className="h-8 w-full rounded-md" />
      </div>
      <div className="flex flex-col gap-4 p-2">
        {TREE_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-1">
            <Skeleton className="mx-2 h-3 w-24" />
            {group.rows.map((row) => (
              <Skeleton key={row} className="h-7 w-full rounded-md" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocsSkeleton() {
  return (
    <div className="flex h-full min-h-0" data-testid="docs-skeleton">
      <TreeSkeleton />
      <div className="flex min-w-0 flex-1 flex-col">
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
