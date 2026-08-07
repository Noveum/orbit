'use client';

import { DEFAULT_LABEL_COLOR } from '@orbit/shared/constants';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
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
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { ColorSwatches } from './color-swatches.tsx';
import type { LabelView, TeamBadge } from './data.ts';

const WORKSPACE_SCOPE = 'workspace';

export interface LabelsPanelProps {
  readonly labels: readonly LabelView[];
  readonly teams: readonly TeamBadge[];
  readonly canManage: boolean;
}

interface LabelRowProps {
  readonly label: LabelView;
  readonly teams: readonly TeamBadge[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onSave: (patch: { name: string; color: string; teamId: string | null }) => Promise<void>;
  readonly onDelete: () => Promise<void>;
}

function scopeName(teams: readonly TeamBadge[], teamId: string | null): string {
  if (teamId === null) return 'Workspace';
  return teams.find((team) => team.id === teamId)?.key ?? 'Team';
}

function LabelRow({ label, teams, canManage, busy, onSave, onDelete }: LabelRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [scope, setScope] = useState(label.teamId ?? WORKSPACE_SCOPE);

  function startEditing(): void {
    setName(label.name);
    setColor(label.color);
    setScope(label.teamId ?? WORKSPACE_SCOPE);
    setEditing(true);
  }

  async function save(): Promise<void> {
    await onSave({ name, color, teamId: scope === WORKSPACE_SCOPE ? null : scope });
    setEditing(false);
  }

  if (!editing) {
    return (
      <li
        className={cn('flex items-center gap-3 rounded-md px-2 py-1.5', rowHover)}
        data-testid="label-row"
      >
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: label.color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-dense text-text">{label.name}</span>
        <Badge tone={label.teamId === null ? 'neutral' : 'accent'}>
          {scopeName(teams, label.teamId)}
        </Badge>
        <Button size="sm" variant="ghost" disabled={!canManage || busy} onClick={startEditing}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" disabled={!canManage || busy} onClick={() => onDelete()}>
          Delete
        </Button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={`label-name-${label.id}`} className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Name</span>
          <Input
            id={`label-name-${label.id}`}
            value={name}
            maxLength={48}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="flex w-44 flex-col gap-1.5">
          <span className="font-medium text-dense text-text" id={`label-scope-${label.id}`}>
            Available to
          </span>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger aria-labelledby={`label-scope-${label.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WORKSPACE_SCOPE}>Everyone in the workspace</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ColorSwatches legend="Colour" value={color} onChange={setColor} />
      <div className="flex items-center gap-1">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => save()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </li>
  );
}

export function LabelsPanel({ labels, teams, canManage }: LabelsPanelProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [scope, setScope] = useState<string>(WORKSPACE_SCOPE);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string | null, action: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest('/api/labels', {
        method: 'POST',
        body: { name, color, teamId: scope === WORKSPACE_SCOPE ? null : scope },
      });
      setName('');
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={onCreate}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="new-label-name" className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="font-medium text-dense text-text">Label name</span>
            <Input
              id="new-label-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={48}
              placeholder="Regression"
              disabled={!canManage || pending}
              name="labelName"
            />
          </label>
          <div className="flex w-56 flex-col gap-1.5">
            <span className="font-medium text-dense text-text" id="new-label-scope">
              Available to
            </span>
            <Select value={scope} onValueChange={setScope} disabled={!canManage || pending}>
              <SelectTrigger aria-labelledby="new-label-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WORKSPACE_SCOPE}>Everyone in the workspace</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="primary" disabled={!canManage || pending}>
            {pending ? 'Creating' : 'Create label'}
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

      {labels.length === 0 ? (
        <p className="text-muted text-xs">No labels yet. The first one goes above.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {labels.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              teams={teams}
              canManage={canManage}
              busy={busyId === label.id}
              onSave={(patch) =>
                run(label.id, () =>
                  apiRequest(`/api/labels/${label.id}`, { method: 'PATCH', body: patch }),
                )
              }
              onDelete={() =>
                run(label.id, () => apiRequest(`/api/labels/${label.id}`, { method: 'DELETE' }))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
