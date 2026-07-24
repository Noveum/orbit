'use client';

import { conditionsOf, VIEW_VISIBILITY_LABELS } from '@orbit/shared/filters';
import { Columns3, LayoutList, Lock, Pencil, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Input } from '@/components/ui/input.tsx';
import { buildFilterFields, describeCondition } from '@/features/filters/filter-fields.tsx';
import { VIEW_PARAM, withViewParam } from '@/features/filters/use-view-config.ts';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { viewConfigFromState, viewConfigSearch } from '@/features/filters/view-config.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { ViewsSkeleton } from '@/features/views/views-skeleton.tsx';
import { cn } from '@/lib/cn.ts';
import type { View } from '@/lib/query/schemas.ts';
import {
  useDeleteView,
  useToggleViewFavorite,
  useUpdateView,
  useViews,
} from '@/lib/query/use-views.ts';

function layoutMode(layout: string): ViewLayoutMode {
  return layout === 'board' ? 'board' : 'list';
}

export function ViewsPage() {
  const workspace = useWorkspace();
  const views = useViews();

  const rows = views.data ?? [];
  const builtIn = rows.filter((view) => view.virtual);
  const mine = rows.filter((view) => !view.virtual && view.ownerId === workspace.userId);
  const shared = rows.filter((view) => !view.virtual && view.ownerId !== workspace.userId);

  if (views.isPending) {
    return <ViewsSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6" data-testid="views-page">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">Views</h1>
        <p className="text-muted text-xs">
          Saved filters, grouping and display options. Yours stay private unless you share them.
        </p>
      </header>

      <ViewSection title="Built in" views={builtIn} />
      <ViewSection title="Your views" views={mine} />
      <ViewSection title="Shared with you" views={shared} />

      {mine.length === 0 && shared.length === 0 ? (
        <EmptyState
          icon={<LayoutList strokeWidth={1.75} aria-hidden="true" />}
          title="No saved views yet"
          description="Filter a team's issues, then press Alt+V to keep that setup as a view."
        />
      ) : null}
    </div>
  );
}

function ViewSection({ title, views }: { title: string; views: readonly View[] }) {
  if (views.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-2xs text-faint uppercase tracking-wide">{title}</h2>
      <table className="w-full border-collapse text-dense">
        <thead>
          <tr className="border-border border-b text-left text-2xs text-faint">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Name
            </th>
            <th scope="col" className="hidden py-1.5 pr-3 font-medium sm:table-cell">
              Owner
            </th>
            <th scope="col" className="hidden py-1.5 pr-3 font-medium md:table-cell">
              Visibility
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {views.map((view) => (
            <ViewRow key={view.id} view={view} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ViewRow({ view }: { view: View }) {
  const workspace = useWorkspace();
  const update = useUpdateView();
  const remove = useDeleteView();
  const favorite = useToggleViewFavorite();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(view.name);

  const filterTeamId = view.filter.teamId;
  const team =
    workspace.teams.find((entry) => entry.id === filterTeamId) ?? workspace.teams[0] ?? null;
  const layout = layoutMode(view.layout);
  const config = viewConfigFromState(view.filter);
  const owner = workspace.members.find((member) => member.id === view.ownerId);
  const editable = !(view.virtual || view.locked) && view.ownerId === workspace.userId;

  const href =
    team === null
      ? `/views?${VIEW_PARAM}=${encodeURIComponent(view.id)}`
      : `/team/${team.key.toLowerCase()}/${layout === 'board' ? 'board' : 'issues'}${withViewParam(
          viewConfigSearch(config, layout),
          view.id,
        )}`;

  const submitRename = () => {
    const trimmed = name.trim();
    setRenaming(false);
    if (trimmed.length === 0 || trimmed === view.name) return;
    update.mutate({ id: view.id, patch: { name: trimmed } });
  };

  return (
    <tr className="border-border border-b" data-testid={`view-${view.name}`}>
      <td className="py-2 pr-3 align-top">
        <div className="flex flex-col gap-1">
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
            <span className="flex items-center gap-1.5">
              <Link
                href={href}
                data-testid={`open-${view.name}`}
                className="font-medium text-text hover:text-accent"
              >
                {view.name}
              </Link>
              {view.locked ? (
                <Lock className="size-3 text-faint" aria-label="Locked" role="img" />
              ) : null}
            </span>
          )}
          <ViewSummary view={view} layout={layout} />
        </div>
      </td>
      <td className="hidden py-2 pr-3 align-top text-muted sm:table-cell">
        {view.virtual ? 'Built in' : (owner?.name ?? 'Someone else')}
      </td>
      <td className="hidden py-2 pr-3 align-top text-muted md:table-cell">
        {VIEW_VISIBILITY_LABELS[view.filter.visibility]}
      </td>
      <td className="py-2 align-top">
        <div className="flex items-center justify-end gap-1">
          {view.virtual ? null : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={view.favorite ? `Unstar ${view.name}` : `Star ${view.name}`}
              aria-pressed={view.favorite}
              data-testid={`star-${view.name}`}
              onClick={() => favorite.mutate({ id: view.id, favorite: !view.favorite })}
            >
              <Star
                className={cn('size-3.5', view.favorite && 'fill-current text-accent')}
                aria-hidden="true"
              />
            </Button>
          )}
          {editable ? (
            <>
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
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </>
          ) : null}
          <DeleteViewDialog
            view={view}
            open={confirming}
            onOpenChange={setConfirming}
            onConfirm={() => {
              setConfirming(false);
              remove.mutate(view.id);
            }}
          />
        </div>
      </td>
    </tr>
  );
}

function ViewSummary({ view, layout }: { view: View; layout: ViewLayoutMode }) {
  const workspace = useWorkspace();
  const conditions = conditionsOf(view.filter.filter);
  const fields = useMemo(
    () =>
      buildFilterFields(workspace, view.filter.teamId, [
        ...new Set(conditions.map((entry) => entry.property)),
      ]),
    [workspace, view.filter.teamId, conditions],
  );

  return (
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
      <span>Grouped by {view.filter.groupBy === 'none' ? 'nothing' : view.filter.groupBy}</span>
      {conditions.length === 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span>No filters</span>
        </>
      ) : (
        conditions.map((condition) => (
          <span
            key={condition.property}
            className="rounded-sm border border-border px-1 py-px text-muted"
          >
            {describeCondition(condition, fields)}
          </span>
        ))
      )}
    </p>
  );
}

function DeleteViewDialog({
  view,
  open,
  onOpenChange,
  onConfirm,
}: {
  view: View;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="delete-view-dialog">
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">Delete this view?</DialogTitle>
          <DialogDescription className="text-muted text-xs">
            Deleting "{view.name}" removes it for everyone it is shared with. Issues are untouched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" data-testid="confirm-delete-view" onClick={onConfirm}>
            Delete view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
