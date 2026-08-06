import { Skeleton } from '@/components/ui/skeleton.tsx';

const TILES = [0, 1, 2, 3, 4];
const COLUMNS = [0, 1, 2];
const ROWS = [0, 1, 2, 3];

export function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="standup-skeleton">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
        {TILES.map((tile) => (
          <Skeleton key={tile} className="h-8 w-36 rounded-md" />
        ))}
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-3">
        {COLUMNS.map((column) => (
          <div key={column} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            {ROWS.map((row) => (
              <Skeleton key={row} className="h-7 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
