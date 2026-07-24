import { Skeleton } from '@/components/ui/skeleton.tsx';

const SECTIONS = [
  { id: 'built-in', rows: ['a', 'b'] },
  { id: 'mine', rows: ['a', 'b', 'c'] },
];

export function ViewsSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6" data-testid="views-skeleton">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>

      {SECTIONS.map((section) => (
        <div key={section.id} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-28" />
          <div className="flex flex-col">
            <div className="flex items-center gap-3 border-border border-b py-1.5">
              <Skeleton className="h-2.5 w-16" />
            </div>
            {section.rows.map((row) => (
              <div key={row} className="flex items-start gap-3 border-border border-b py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-2.5 w-64 max-w-full" />
                </div>
                <Skeleton className="hidden h-3 w-16 sm:block" />
                <Skeleton className="hidden h-3 w-20 md:block" />
                <div className="flex items-center gap-1">
                  <Skeleton className="size-6 rounded-md" />
                  <Skeleton className="size-6 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
