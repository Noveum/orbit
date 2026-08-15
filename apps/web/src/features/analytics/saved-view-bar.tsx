'use client';

import type { SavedAnalyticsViewPayload } from '@orbit/core';
import {
  type AnalyticsQuery,
  analyticsQuerySchema,
  type InsightConfig,
  insightConfigSchema,
} from '@orbit/shared/validators';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Pin, Save, Trash2, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { analyticsKeys } from './analytics-keys.ts';
import { canonicalSavedAnalyticsView, searchParamsForInsightConfig } from './query-state.ts';

interface SavedViewBarProps {
  readonly views: readonly SavedAnalyticsViewPayload[];
  readonly query: AnalyticsQuery;
  readonly insight: InsightConfig;
  readonly canManage: boolean;
  readonly canManageAll: boolean;
  readonly currentUserId: string | null;
  readonly onApply: (query: AnalyticsQuery, insight?: InsightConfig) => void;
}

const defaultInsightConfig = insightConfigSchema.parse({});

function queryOf(view: SavedAnalyticsViewPayload): AnalyticsQuery | null {
  const parsed = analyticsQuerySchema.safeParse(view.config['query'] ?? view.config);
  return parsed.success ? parsed.data : null;
}

function insightOf(view: SavedAnalyticsViewPayload): InsightConfig | null {
  const raw = view.config['insight'];
  if (raw === undefined) return null;
  const parsed = insightConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function pinned(view: SavedAnalyticsViewPayload): boolean {
  return view.config['pinned'] === true;
}

function dashboardConfig(
  targetQuery: AnalyticsQuery,
  targetInsight: InsightConfig | null,
  isPinned: boolean,
): Record<string, unknown> {
  const carriesInsight =
    targetInsight !== null && searchParamsForInsightConfig(targetInsight).toString() !== '';
  return {
    kind: 'dashboard',
    version: 1,
    query: targetQuery,
    ...(carriesInsight ? { insight: targetInsight } : {}),
    pinned: isPinned,
  };
}

export function SavedViewBar({
  views,
  query,
  insight,
  canManage,
  canManageAll,
  currentUserId,
  onApply,
}: SavedViewBarProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [localViews, setLocalViews] = useState(views);
  const dashboards = localViews.filter((view) => view.kind === 'dashboard');
  const active = dashboards.find((view) => {
    const saved = queryOf(view);
    if (saved === null) return false;
    const savedInsight = insightOf(view) ?? defaultInsightConfig;
    return (
      canonicalSavedAnalyticsView(saved, savedInsight) ===
      canonicalSavedAnalyticsView(query, insight)
    );
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: analyticsKeys.root });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (name.trim().length === 0) return;
    setPending(true);
    try {
      const response = await apiRequest<{ view: SavedAnalyticsViewPayload }>(
        '/api/analytics/views',
        {
          method: 'POST',
          body: {
            name: name.trim(),
            shared,
            config: dashboardConfig(query, insight, false),
          },
        },
      );
      setLocalViews((current) => [...current, response.view]);
      setName('');
      setShared(false);
      setEditing(false);
      await refresh();
    } catch (error) {
      toast({ title: 'Could not save that view', description: messageOf(error), tone: 'danger' });
    } finally {
      setPending(false);
    }
  }

  async function update(id: string, body: Record<string, unknown>): Promise<void> {
    setPending(true);
    try {
      const response = await apiRequest<{ view: SavedAnalyticsViewPayload }>(
        `/api/analytics/views/${id}`,
        { method: 'PATCH', body },
      );
      setLocalViews((current) =>
        current.map((view) => (view.id === response.view.id ? response.view : view)),
      );
      await refresh();
    } catch (error) {
      toast({ title: 'Could not update that view', description: messageOf(error), tone: 'danger' });
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setPending(true);
    try {
      await apiRequest(`/api/analytics/views/${id}`, { method: 'DELETE' });
      setLocalViews((current) => current.filter((view) => view.id !== id));
      await refresh();
    } catch (error) {
      toast({ title: 'Could not delete that view', description: messageOf(error), tone: 'danger' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="saved-analytics-views">
      {dashboards.map((view) => {
        const saved = queryOf(view);
        const editable = canManage && (canManageAll || view.ownerId === currentUserId);
        return (
          <div
            className="inline-flex items-center rounded-md border border-border bg-surface-2"
            key={view.id}
          >
            {renamingId === view.id ? (
              <form
                className="flex items-center gap-1 p-1"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const nextName = renameValue.trim();
                  if (nextName.length === 0) return;
                  await update(view.id, { name: nextName });
                  setRenamingId(null);
                }}
              >
                <input
                  aria-label={`Rename ${view.name}`}
                  className="h-6 w-28 rounded border border-border bg-surface px-1.5 text-text text-xs"
                  onChange={(event) => setRenameValue(event.target.value)}
                  value={renameValue}
                />
                <Button disabled={pending} size="sm" type="submit" variant="ghost">
                  Save
                </Button>
              </form>
            ) : (
              <button
                className="rounded-l-md px-2.5 py-1.5 text-muted text-xs hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                disabled={saved === null}
                onClick={() => {
                  if (saved === null) return;
                  onApply(saved, insightOf(view) ?? undefined);
                }}
                type="button"
              >
                {view.name}
              </button>
            )}
            {editable ? (
              <>
                <button
                  aria-label={`${pinned(view) ? 'Unpin' : 'Pin'} ${view.name}`}
                  className="p-1.5 text-faint hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  disabled={pending}
                  onClick={() =>
                    update(view.id, {
                      config: dashboardConfig(
                        saved ?? query,
                        saved === null ? insight : insightOf(view),
                        !pinned(view),
                      ),
                    })
                  }
                  type="button"
                >
                  <Pin
                    aria-hidden="true"
                    className="size-3"
                    fill={pinned(view) ? 'currentColor' : 'none'}
                  />
                </button>
                <button
                  aria-label={`${view.shared ? 'Make private' : 'Share'} ${view.name}`}
                  className="p-1.5 text-faint hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  disabled={pending}
                  onClick={() => update(view.id, { shared: !view.shared })}
                  type="button"
                >
                  <Users
                    aria-hidden="true"
                    className="size-3"
                    fill={view.shared ? 'currentColor' : 'none'}
                  />
                </button>
                <button
                  aria-label={`Rename ${view.name}`}
                  className="p-1.5 text-faint hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  disabled={pending}
                  onClick={() => {
                    setRenamingId(view.id);
                    setRenameValue(view.name);
                  }}
                  type="button"
                >
                  <Pencil aria-hidden="true" className="size-3" />
                </button>
                <button
                  aria-label={`Delete ${view.name}`}
                  className="p-1.5 text-faint hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger"
                  disabled={pending}
                  onClick={() => remove(view.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="size-3" />
                </button>
              </>
            ) : null}
          </div>
        );
      })}
      {canManage && active !== undefined && (canManageAll || active.ownerId === currentUserId) ? (
        <Button
          disabled={pending}
          onClick={() =>
            update(active.id, {
              config: dashboardConfig(query, insight, pinned(active)),
            })
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          Update view
        </Button>
      ) : null}
      {canManage && !editing ? (
        <Button onClick={() => setEditing(true)} size="sm" type="button" variant="ghost">
          <Save aria-hidden="true" className="size-3.5" />
          Save view
        </Button>
      ) : null}
      {canManage && editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
          <input
            aria-label="Analytics view name"
            className="h-7 w-36 rounded-md border border-border bg-surface px-2 text-text text-xs"
            onChange={(event) => setName(event.target.value)}
            placeholder="View name"
            type="text"
            value={name}
          />
          <label className="flex items-center gap-1 text-muted text-xs">
            <input
              checked={shared}
              onChange={(event) => setShared(event.target.checked)}
              type="checkbox"
            />
            Share with workspace
          </label>
          <Button disabled={pending} size="sm" type="submit" variant="primary">
            Save
          </Button>
          <Button onClick={() => setEditing(false)} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        </form>
      ) : null}
    </div>
  );
}
