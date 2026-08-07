import { Skeleton } from '@/components/ui/skeleton.tsx';

export default function StandupLoading() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-2/3" />
    </div>
  );
}
