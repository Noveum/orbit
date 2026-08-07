'use client';

import {
  conditionsOf,
  isVirtualViewId,
  VIEW_VISIBILITY_LABELS,
  VIRTUAL_VIEW_DESCRIPTIONS,
} from '@orbit/shared/filters';
import { Columns3, LayoutList, Lock, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { buildFilterFields, describeCondition } from '@/features/filters/filter-fields.tsx';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import type { AudienceTeam } from '@/features/filters/view-visibility.ts';
import { audienceTeam } from '@/features/filters/view-visibility.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { CreateViewDialog } from '@/features/views/create-view-dialog.tsx';
import { viewHref, viewLayoutMode } from '@/features/views/view-href.ts';
import { ViewsSkeleton } from '@/features/views/views-skeleton.tsx';
import { cn } from '@/lib/cn.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { View } from '@/lib/query/schemas.ts';
import {
  useDeleteView,
  useToggleViewFavorite,
  useUpdateView,
  useViews,
} from '@/lib/query/use-views.ts';

export function visibilityLabel(view: View, teams: readonly AudienceTeam[]): string {
  if (view.virtual) return 'Everyone';
  if (view.filter.visibility !== 'team') return VIEW_VISIBILITY_LABELS[view.filter.visibility];
  const team = audienceTeam(teams, view.filter.teamId);
  return team === null ? VIEW_VISIBILITY_LABELS.team : `Everyone on ${team.name}`;
}

export function ViewsPage() {
  const workspace = useWorkspace();
  const views = useViews();
  const [creating, setCreating] = useState(false);

  useHotkey('alt+v', () => setCreating(true), { label: 'New view', section: 'View' });

  const rows = views.data ?? [];
  const builtIn = rows.filter((view) => view.virtual);
  const mine = rows.filter((view) => !view.virtual && view.ownerId === workspace.userId);
  const shared = rows.filter((view) => !view.virtual && view.ownerId !== workspace.userId);

  if (views.isPending) {
    return <ViewsSkeleton />;
  }

  return (
    <div className="flex flex-col gap-7 px-6 py-6" data-testid="views-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-lg text-text">Views</h1>
          <p className="text-muted text-xs">
            Saved filters, grouping and display options. Yours stay private unless you share them.
          </p>
        </div>
        <Button variant="primary" data-testid="new-view" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" aria-hidden="true" />
          New view
        </Button>
      </header>

      <ViewSection
        title="Built in"
        description="Always here, for everyone in the workspace."
        views={builtIn}
      />
      <ViewSection
        title="Your views"
        description="Only you see these until you share them."
        views={mine}
        empty={<NoSavedViews onCreate={() => setCreating(true)} />}
      />
      <ViewSection
        title="Shared with you"
        description="Saved by teammates and shared with your workspace or your team."
        views={shared}
      />

      <CreateViewDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NoSavedViews({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="flex flex-col items-start gap-2 rounded-md border border-border border-dashed px-4 py-5"
      data-testid="no-saved-views"
    >
      <p className="text-muted text-xs">
        You have not saved a view yet. Build one here, or filter any issue list and press Alt+V.
      </p>
      <Button size="sm" data-testid="new-view-empty" onClick={onCreate}>
        <Plus className="size-3.5" aria-hidden="true" />
        New view
      </Button>
    </div>
  );
}

interface ViewSectionProps {
  readonly title: string;
  readonly description: string;
  readonly views: readonly View[];
  readonly empty?: ReactNode;
}

function ViewSection({ title, description, views, empty }: ViewSectionProps) {
  if (views.length === 0 && empty === undefined) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium text-2xs text-faint uppercase tracking-wide">{title}</h2>
        <p className="text-2xs text-faint">{description}</p>
      </div>
      {views.length === 0 ? (
        empty
      ) : (
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
      )}
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

  const layout = viewLayoutMode(view.layout);
  const owner = workspace.members.find((member) => member.id === view.ownerId);
  const editable = !(view.virtual || view.locked) && view.ownerId === workspace.userId;
  const href = viewHref(view, workspace);

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
              {view.locked && !view.virtual ? (
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
        {visibilityLabel(view, workspace.teams)}
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

function builtInDescription(view: View): string | null {
  if (!isVirtualViewId(view.id)) return null;
  return VIRTUAL_VIEW_DESCRIPTIONS[view.id];
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

  const description = builtInDescription(view);
  if (description !== null) {
    return <p className="text-2xs text-faint">{description}</p>;
  }

  if (!view.readable) {
    return (
      <p className="text-2xs text-danger" data-testid={`unreadable-${view.name}`}>
        Orbit could not read what this view stored, so it shows the defaults. Open it and save it
        again to replace them.
      </p>
    );
  }

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
