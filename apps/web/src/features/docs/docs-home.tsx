'use client';

import { relativeTime } from '@orbit/shared/utils';
import type { LucideIcon } from 'lucide-react';
import { Clock, FileText, History, Star } from 'lucide-react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import type { DocHomeEntry } from '@/lib/query/schemas.ts';
import { useDocsHome } from '@/lib/query/use-docs.ts';

export interface DocsHomeSectionProps {
  readonly id: string;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly entries: readonly DocHomeEntry[];
  readonly emptyLabel: string;
  readonly now: Date;
}

export function DocsHomeSection({
  id,
  title,
  icon: Icon,
  entries,
  emptyLabel,
  now,
}: DocsHomeSectionProps) {
  return (
    <section data-testid={`docs-home-${id}`} className="flex min-w-0 flex-col gap-1">
      <h2 className="flex items-center gap-1.5 px-2 font-medium text-2xs text-faint uppercase tracking-wide">
        <Icon className="size-3" strokeWidth={1.75} aria-hidden="true" />
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="px-2 py-1.5 text-dense text-faint">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/docs/${entry.id}`}
                data-testid={`docs-home-${id}-${entry.id}`}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-dense text-muted hover:text-text',
                  rowHover,
                )}
              >
                <FileText className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="shrink-0 text-2xs text-faint tabular-nums">
                  {relativeTime(new Date(entry.updatedAt), now)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DocsHome() {
  const home = useDocsHome();
  const now = new Date();

  if (home.isPending) {
    return (
      <div data-testid="docs-home-skeleton" className="flex flex-col gap-6 p-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const data = home.data ?? { recent: [], favorites: [], updated: [] };

  return (
    <div
      data-testid="docs-home"
      className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-8 px-6 py-8 md:grid-cols-2"
    >
      <DocsHomeSection
        id="recent"
        title="Recently viewed"
        icon={Clock}
        entries={data.recent}
        emptyLabel="Docs you open show up here."
        now={now}
      />
      <DocsHomeSection
        id="favorites"
        title="Favourites"
        icon={Star}
        entries={data.favorites}
        emptyLabel="Star a doc to keep it here."
        now={now}
      />
      <DocsHomeSection
        id="updated"
        title="What changed"
        icon={History}
        entries={data.updated}
        emptyLabel="Nothing has changed yet."
        now={now}
      />
    </div>
  );
}
