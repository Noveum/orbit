'use client';

import {
  DEFAULT_STATE_COLOR,
  STATE_CATEGORIES,
  STATE_CATEGORY_LABELS,
  type StateCategory,
} from '@orbit/shared/constants';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { ApiRequestError, apiRequest, messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { ColorSwatches } from './color-swatches.tsx';
import type { TeamBadge, WorkflowStateView } from './data.ts';

export interface WorkflowPanelProps {
  readonly teams: readonly TeamBadge[];
  readonly states: readonly WorkflowStateView[];
  readonly canManage: boolean;
}

interface StateRowProps {
  readonly state: WorkflowStateView;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly first: boolean;
  readonly last: boolean;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onSave: (patch: {
    name: string;
    category: StateCategory;
    color: string;
  }) => Promise<void>;
  readonly onDelete: () => void;
}

function StateRow({
  state,
  canManage,
  busy,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: StateRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(state.name);
  const [category, setCategory] = useState<StateCategory>(state.category);
  const [color, setColor] = useState(state.color);

  function startEditing(): void {
    setName(state.name);
    setCategory(state.category);
    setColor(state.color);
    setEditing(true);
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-3 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label
            htmlFor={`state-name-${state.id}`}
            className="flex min-w-48 flex-1 flex-col gap-1.5"
          >
            <span className="font-medium text-dense text-text">Name</span>
            <Input
              id={`state-name-${state.id}`}
              value={name}
              maxLength={48}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex w-48 flex-col gap-1.5">
            <span className="font-medium text-dense text-text" id={`state-category-${state.id}`}>
              Category
            </span>
            <Select value={category} onValueChange={(next) => setCategory(next as StateCategory)}>
              <SelectTrigger aria-labelledby={`state-category-${state.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATE_CATEGORIES.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {STATE_CATEGORY_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-faint text-2xs">
          Moving a status to another category re-dates every issue sitting in it, because started,
          completed and canceled are read from the category.
        </p>
        <ColorSwatches legend="Colour" value={color} onChange={setColor} />
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => onSave({ name, category, color }).then(() => setEditing(false))}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn('flex items-center gap-3 rounded-md px-2 py-1.5', rowHover)}
      data-testid="workflow-state-row"
    >
      <span
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: state.color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-dense text-text">{state.name}</span>
      <Badge tone="neutral">{STATE_CATEGORY_LABELS[state.category]}</Badge>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Move ${state.name} earlier`}
        disabled={!canManage || busy || first}
        onClick={() => onMove(-1)}
      >
        <ChevronUp className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Move ${state.name} later`}
        disabled={!canManage || busy || last}
        onClick={() => onMove(1)}
      >
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </Button>
      <Button size="sm" variant="ghost" disabled={!canManage || busy} onClick={startEditing}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" disabled={!canManage || busy} onClick={onDelete}>
        Delete
      </Button>
    </li>
  );
}

interface BlockedDelete {
  readonly stateId: string;
  readonly message: string;
}

function reordered(
  ids: readonly string[],
  stateId: string,
  direction: -1 | 1,
): readonly string[] | null {
  const at = ids.indexOf(stateId);
  const to = at + direction;
  if (at === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  const moving = next[at];
  const displaced = next[to];
  if (moving === undefined || displaced === undefined) return null;
  next[at] = displaced;
  next[to] = moving;
  return next;
}

export function WorkflowPanel({ teams, states, canManage }: WorkflowPanelProps) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StateCategory>('unstarted');
  const [color, setColor] = useState(DEFAULT_STATE_COLOR);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedDelete | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const ordered = useMemo(
    () =>
      states
        .filter((state) => state.teamId === teamId)
        .slice()
        .sort((left, right) => left.position - right.position),
    [states, teamId],
  );

  async function run(id: string | null, action: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
      throw caught;
    } finally {
      setBusyId(null);
    }
  }

  function guarded(id: string | null, action: () => Promise<unknown>): Promise<void> {
    return run(id, action).catch(() => undefined);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest('/api/workflow-states', {
        method: 'POST',
        body: { teamId, name, category, color },
      });
      setName('');
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  function onMove(stateId: string, direction: -1 | 1): Promise<void> {
    const next = reordered(
      ordered.map((state) => state.id),
      stateId,
      direction,
    );
    if (next === null) return Promise.resolve();
    return guarded(stateId, () =>
      apiRequest('/api/workflow-states/reorder', {
        method: 'POST',
        body: { teamId, stateIds: next },
      }),
    );
  }

  async function onDelete(stateId: string): Promise<void> {
    setBusyId(stateId);
    setError(null);
    setBlocked(null);
    try {
      await apiRequest(`/api/workflow-states/${stateId}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      const others = ordered.filter((state) => state.id !== stateId);
      if (caught instanceof ApiRequestError && caught.is('conflict') && others.length > 0) {
        setBlocked({ stateId, message: caught.message });
        setMoveTo(others[0]?.id ?? '');
      } else {
        setError(messageOf(caught));
      }
    } finally {
      setBusyId(null);
    }
  }

  const blockedState = ordered.find((state) => state.id === blocked?.stateId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex w-64 max-w-full flex-col gap-1.5">
        <span className="font-medium text-dense text-text" id="workflow-team">
          Team
        </span>
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger aria-labelledby="workflow-team">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <form
        onSubmit={onCreate}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="new-state-name" className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="font-medium text-dense text-text">Status name</span>
            <Input
              id="new-state-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={48}
              placeholder="Blocked"
              disabled={!canManage || pending}
              name="stateName"
            />
          </label>
          <div className="flex w-48 flex-col gap-1.5">
            <span className="font-medium text-dense text-text" id="new-state-category">
              Category
            </span>
            <Select
              value={category}
              onValueChange={(next) => setCategory(next as StateCategory)}
              disabled={!canManage || pending}
            >
              <SelectTrigger aria-labelledby="new-state-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATE_CATEGORIES.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {STATE_CATEGORY_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="primary" disabled={!canManage || pending || teamId === ''}>
            {pending ? 'Adding' : 'Add status'}
          </Button>
        </div>
        <ColorSwatches
          legend="Colour"
          value={color}
          onChange={setColor}
          disabled={!canManage || pending}
        />
      </form>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      {blocked === null || blockedState === null ? null : (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <p className="text-dense text-text">{blocked.message}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-56 flex-col gap-1.5">
              <span className="font-medium text-dense text-text" id="move-issues-to">
                Move its issues to
              </span>
              <Select value={moveTo} onValueChange={setMoveTo}>
                <SelectTrigger aria-labelledby="move-issues-to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ordered
                    .filter((state) => state.id !== blocked.stateId)
                    .map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="primary"
              disabled={!canManage || moveTo === ''}
              onClick={() => {
                setBlocked(null);
                return guarded(blocked.stateId, () =>
                  apiRequest(
                    `/api/workflow-states/${blocked.stateId}?moveToStateId=${encodeURIComponent(moveTo)}`,
                    { method: 'DELETE' },
                  ),
                );
              }}
            >
              Move and delete
            </Button>
            <Button variant="ghost" onClick={() => setBlocked(null)}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="text-muted text-xs">That team has no statuses yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {ordered.map((state, index) => (
            <StateRow
              key={state.id}
              state={state}
              canManage={canManage}
              busy={busyId === state.id}
              first={index === 0}
              last={index === ordered.length - 1}
              onMove={(direction) => onMove(state.id, direction)}
              onSave={(patch) =>
                run(state.id, () =>
                  apiRequest(`/api/workflow-states/${state.id}`, { method: 'PATCH', body: patch }),
                )
              }
              onDelete={() => onDelete(state.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
