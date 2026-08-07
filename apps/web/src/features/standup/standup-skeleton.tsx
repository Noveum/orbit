import { Skeleton } from '@/components/ui/skeleton.tsx';

const TILES = [0, 1, 2, 3, 4, 5];
const COLUMNS = [0, 1, 2];
const CARDS = [0, 1, 2];

export function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="standup-skeleton">
      <div className="flex shrink-0 gap-2 overflow-hidden border-border border-b px-3 py-3">
        {TILES.map((tile) => (
          <div
            key={tile}
            className="flex w-40 shrink-0 flex-col gap-2 rounded-lg border border-border p-3"
          >
            <Skeleton className="size-5.5 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-12" />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {COLUMNS.map((column) => (
          <div
            key={column}
            className="flex min-w-72 max-w-[26rem] flex-1 shrink-0 flex-col gap-2 rounded-lg bg-surface-2/60"
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex flex-col gap-2 px-2 pb-2">
              {CARDS.map((card) => (
                <Skeleton key={card} className="h-[4.75rem] w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
