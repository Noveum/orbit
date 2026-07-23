'use client';

import type { FilterPredicate } from '@orbit/shared/filters';
import { Columns3, LayoutList, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { buildFilterFields, describePredicate } from '@/features/filters/filter-fields.tsx';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { viewConfigFromStored, viewConfigSearch } from '@/features/filters/view-config.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import type { View } from '@/lib/query/schemas.ts';
import { useDeleteView, useUpdateView, useViews } from '@/lib/query/use-views.ts';

function layoutMode(layout: string): ViewLayoutMode {
  return layout === 'board' ? 'board' : 'list';
}

export function ViewsPage() {
  const workspace = useWorkspace();
  const views = useViews();

  const mine = (views.data ?? []).filter((view) => view.ownerId === workspace.userId);
  const shared = (views.data ?? []).filter((view) => view.ownerId !== workspace.userId);

  if (views.isPending) {
    return (
      <div className="flex flex-col gap-3 px-6 py-6" data-testid="views-skeleton">
        <Skeleton className="h-6 w-32" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if ((views.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={<LayoutList strokeWidth={1.75} aria-hidden="true" />}
        title="No saved views yet"
        description="Filter a team's issues, then press Alt+V to keep that setup as a view."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6" data-testid="views-page">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">Views</h1>
        <p className="text-muted text-xs">
          Saved filters and layouts. Yours stay private unless you share them.
        </p>
      </header>

      <ViewSection title="Your views" views={mine} editable />
      <ViewSection title="Shared with the workspace" views={shared} editable={false} />
    </div>
  );
}

function ViewSection({
  title,
  views,
  editable,
}: {
  title: string;
  views: readonly View[];
  editable: boolean;
}) {
  if (views.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-2xs text-faint uppercase tracking-wide">{title}</h2>
      <ul className="flex flex-col gap-2">
        {views.map((view) => (
          <ViewCard key={view.id} view={view} editable={editable} />
        ))}
      </ul>
    </section>
  );
}

function ViewCard({ view, editable }: { view: View; editable: boolean }) {
  const workspace = useWorkspace();
  const update = useUpdateView();
  const remove = useDeleteView();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view.name);

  const filterTeamId = typeof view.filter.teamId === 'string' ? view.filter.teamId : null;
  const team =
    workspace.teams.find((entry) => entry.id === filterTeamId) ?? workspace.teams[0] ?? null;
  const layout = layoutMode(view.layout);
  const fields = useMemo(
    () => buildFilterFields(workspace, filterTeamId),
    [workspace, filterTeamId],
  );

  const predicates: readonly FilterPredicate[] = view.filter.predicates ?? [];
  const config = viewConfigFromStored(
    {
      predicates,
      ...(view.filter.orderBy === undefined ? {} : { orderBy: view.filter.orderBy }),
      ...(view.filter.includeSubIssues === undefined
        ? {}
        : { includeSubIssues: view.filter.includeSubIssues }),
    },
    view.groupBy,
    layout,
  );

  const href =
    team === null
      ? '#'
      : `/team/${team.key.toLowerCase()}/${layout === 'board' ? 'board' : 'issues'}${viewConfigSearch(config, layout)}`;

  const submitRename = () => {
    const trimmed = name.trim();
    setRenaming(false);
    if (trimmed.length === 0 || trimmed === view.name) return;
    update.mutate({ id: view.id, patch: { name: trimmed } });
  };

  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center"
      data-testid={`view-${view.name}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {renaming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
          >
            <Input
              autoFocus
              value={name}
              maxLength={120}
              aria-label={`Rename ${view.name}`}
              data-testid={`rename-input-${view.name}`}
              onChange={(event) => setName(event.target.value)}
              onBlur={submitRename}
              className="h-7"
            />
          </form>
        ) : (
          <Link href={href} className="font-medium text-dense text-text hover:text-accent">
            {view.name}
          </Link>
        )}
        <p className="flex flex-wrap items-center gap-1.5 text-2xs text-faint">
          <span className="flex items-center gap-1">
            {layout === 'board' ? (
              <Columns3 className="size-3" aria-hidden="true" />
            ) : (
              <LayoutList className="size-3" aria-hidden="true" />
            )}
            {layout === 'board' ? 'Board' : 'List'}
          </span>
          <span aria-hidden="true">·</span>
          <span>Grouped by {view.groupBy === 'none' ? 'nothing' : view.groupBy}</span>
          {predicates.length === 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>No filters</span>
            </>
          ) : (
            predicates.map((predicate) => (
              <span
                key={predicate.field}
                className="rounded-sm border border-border px-1 py-px text-muted"
              >
                {describePredicate(predicate, fields)}
              </span>
            ))
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {editable ? (
          <>
            <span className="flex items-center gap-1.5 text-2xs text-faint">
              Shared
              <Switch
                checked={view.shared}
                aria-label={`Share ${view.name} with the workspace`}
                data-testid={`share-${view.name}`}
                onCheckedChange={(next) => update.mutate({ id: view.id, patch: { shared: next } })}
              />
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Rename ${view.name}`}
              data-testid={`rename-${view.name}`}
              onClick={() => {
                setName(view.name);
                setRenaming(true);
              }}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${view.name}`}
              data-testid={`delete-${view.name}`}
              onClick={() => remove.mutate(view.id)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </>
        ) : null}
        <Button size="sm" asChild data-testid={`open-${view.name}`}>
          <Link href={href}>Open</Link>
        </Button>
      </div>
    </li>
  );
}
