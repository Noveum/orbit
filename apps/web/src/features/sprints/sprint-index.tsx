import Link from 'next/link';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import type { SprintIndexEntry, SprintIndexPage } from './data.ts';

const STATE_LABEL: Record<SprintIndexEntry['state'], string> = {
  running: 'Running',
  upcoming: 'Upcoming',
  overdue: 'Past its end date',
  finished: 'Finished',
};

const STATE_TONE: Record<SprintIndexEntry['state'], string> = {
  running: 'bg-accent/15 text-accent',
  upcoming: 'bg-subtle text-muted',
  overdue: 'bg-warning/15 text-warning',
  finished: 'bg-subtle text-faint',
};

function span(startsAt: string, endsAt: string): string {
  const format = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });
  return `${format.format(new Date(startsAt))} to ${format.format(new Date(endsAt))}`;
}

export function SprintIndex({ page }: { readonly page: SprintIndexPage }) {
  if (page.sprints.length === 0) {
    return <p className="text-faint text-xs">No sprints yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col rounded-lg border border-border" data-testid="sprint-index">
        {page.sprints.map((sprint) => (
          <li key={sprint.id} className="border-border border-b last:border-b-0">
            <Link
              href={`/sprints?sprint=${sprint.number}`}
              data-testid={`sprint-index-${sprint.number}`}
              className={cn(
                'flex items-center gap-3 px-3 py-2 outline-none',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
                rowHover,
              )}
            >
              <span className="min-w-0 flex-1 truncate text-dense text-text">{sprint.name}</span>
              <span
                className={cn('shrink-0 rounded px-1.5 py-0.5 text-2xs', STATE_TONE[sprint.state])}
              >
                {STATE_LABEL[sprint.state]}
              </span>
              <span className="w-40 shrink-0 text-right text-2xs text-faint tabular">
                {span(sprint.startsAt, sprint.endsAt)}
              </span>
              <span className="w-20 shrink-0 text-right text-2xs text-muted tabular">
                {sprint.issues} {sprint.issues === 1 ? 'task' : 'tasks'}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {page.pageCount === 1 ? null : (
        <nav className="flex items-center justify-between" aria-label="Sprint pages">
          <PageLink page={page.page - 1} disabled={page.page <= 1} testId="sprint-index-previous">
            Previous
          </PageLink>
          <span className="text-2xs text-faint tabular">
            Page {page.page} of {page.pageCount}, {page.total} sprints
          </span>
          <PageLink
            page={page.page + 1}
            disabled={page.page >= page.pageCount}
            testId="sprint-index-next"
          >
            Next
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({
  page,
  disabled,
  testId,
  children,
}: {
  readonly page: number;
  readonly disabled: boolean;
  readonly testId: string;
  readonly children: string;
}) {
  if (disabled) {
    return (
      <span className="rounded-md px-2 py-1 text-2xs text-faint" data-testid={testId}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={`/sprints/all?page=${page}`}
      data-testid={testId}
      className={cn(
        'rounded-md px-2 py-1 text-2xs text-muted outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent',
        rowHover,
      )}
    >
      {children}
    </Link>
  );
}
