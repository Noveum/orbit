import { Skeleton } from '@/components/ui/skeleton.tsx';

const COLUMNS = [0, 1, 2, 3, 4];
const CARDS = [0, 1, 2];

export function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3" data-testid="standup-skeleton">
      {COLUMNS.map((column) => (
        <div key={column} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-surface-2/60">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <Skeleton className="size-5.5 rounded-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex flex-col gap-2 px-2 pb-2">
            {CARDS.map((card) => (
              <Skeleton key={card} className="h-[4.75rem] w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
