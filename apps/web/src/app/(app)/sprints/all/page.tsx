import type { Metadata } from 'next';
import Link from 'next/link';
import { listSprintIndex } from '@/features/sprints/data.ts';
import { SprintIndex } from '@/features/sprints/sprint-index.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';

export const metadata: Metadata = { title: 'All sprints' };

interface PageProps {
  readonly searchParams: Promise<{ page?: string }>;
}

const PAGE_NUMBER = /^[1-9][0-9]{0,6}$/;

export default async function AllSprintsPage({ searchParams }: PageProps) {
  const { principal } = await pageContext();
  const { page: wanted } = await searchParams;
  const page = await listSprintIndex(
    principal,
    wanted !== undefined && PAGE_NUMBER.test(wanted) ? Number(wanted) : 1,
  );

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-base text-text">All sprints</h2>
        <Link
          href="/sprints"
          data-testid="sprint-index-back"
          className={cn(
            'rounded-md px-2 py-1 text-muted text-xs outline-none',
            'focus-visible:ring-2 focus-visible:ring-accent',
            rowHover,
          )}
        >
          Back to the current sprint
        </Link>
      </div>
      <SprintIndex page={page} />
    </div>
  );
}
