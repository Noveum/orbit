import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import type { WorkspaceProjectUpdateView } from './data.ts';
import { formatDay } from './dates.ts';
import { HealthChip } from './health-chip.tsx';

function formatDate(value: string): string {
  return formatDay(value, { withYear: true, missing: 'No date' });
}

export function ProjectUpdatesFeed({
  updates,
}: {
  readonly updates: readonly WorkspaceProjectUpdateView[];
}) {
  if (updates.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="font-medium text-muted text-sm">No project updates posted yet</p>
        <p className="mt-1 text-faint text-xs">
          When team leads post health updates to their projects, they will appear here in a single
          stream.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Project updates feed">
      {updates.map((update) => (
        <li
          key={update.id}
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-border bg-surface p-4',
            cardHover,
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/projects/${update.projectSlug}`}
                className="font-medium text-sm text-text transition-colors hover:text-accent"
              >
                {update.projectName}
              </Link>
              <HealthChip health={update.health} />
            </div>
            <time className="text-2xs text-faint tabular" dateTime={update.createdAt}>
              {formatDate(update.createdAt)}
            </time>
          </div>

          <p className="whitespace-pre-wrap text-muted text-xs leading-relaxed">{update.body}</p>

          {update.author === null ? null : (
            <div className="flex items-center gap-1.5 border-border/50 border-t pt-1 text-2xs text-faint">
              <Avatar name={update.author.name} src={update.author.image} size="xs" />
              <span>
                Posted by <span className="font-medium text-text">{update.author.name}</span>
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
