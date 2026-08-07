'use client';

import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { ProgressBar } from '@/features/charts/donut.tsx';
import { formatDay } from '@/features/projects/dates.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import type { Milestone } from '@/lib/query/schemas.ts';
import {
  type MilestoneDraft,
  useCreateMilestone,
  useDeleteMilestone,
  useMilestones,
  useReorderMilestones,
  useUpdateMilestone,
} from '@/lib/query/use-milestones.ts';

export interface MilestoneBoardProps {
  readonly projectId: string;
  readonly milestones: readonly Milestone[];
  readonly canManage: boolean;
}

function formatDate(value: string | null): string {
  return formatDay(value, { withYear: true, missing: 'No target' });
}

function draftFrom(milestone: Milestone): MilestoneFormValues {
  return {
    name: milestone.name,
    description: milestone.description,
    targetDate: milestone.targetDate === null ? '' : milestone.targetDate.slice(0, 10),
  };
}

export interface MilestoneFormValues {
  readonly name: string;
  readonly description: string;
  readonly targetDate: string;
}

const EMPTY_FORM: MilestoneFormValues = { name: '', description: '', targetDate: '' };

export function milestonePayload(values: MilestoneFormValues): MilestoneDraft {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    targetDate: values.targetDate.length === 0 ? null : values.targetDate,
  };
}

function MilestoneForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  pending,
  testId,
}: {
  readonly values: MilestoneFormValues;
  readonly onChange: (next: MilestoneFormValues) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly testId: string;
}) {
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (values.name.trim().length === 0) return;
    onSubmit();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={values.name}
          maxLength={120}
          placeholder="Milestone name"
          aria-label="Milestone name"
          data-testid={`${testId}-name`}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
        <Input
          type="date"
          value={values.targetDate}
          aria-label="Milestone target date"
          data-testid={`${testId}-target`}
          className="sm:w-44"
          onChange={(event) => onChange({ ...values, targetDate: event.target.value })}
        />
      </div>
      <Textarea
        rows={2}
        maxLength={2000}
        value={values.description}
        placeholder="What has to be true when this milestone lands?"
        aria-label="Milestone description"
        data-testid={`${testId}-description`}
        onChange={(event) => onChange({ ...values, description: event.target.value })}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          data-testid={`${testId}-submit`}
          disabled={pending || values.name.trim().length === 0}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function MilestoneRow({
  milestone,
  canManage,
  index,
  total,
  onEdit,
  onDelete,
  onMove,
  busy,
}: {
  readonly milestone: Milestone;
  readonly canManage: boolean;
  readonly index: number;
  readonly total: number;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly busy: boolean;
}) {
  return (
    <li
      className={cn('flex flex-col gap-2 rounded-lg border border-border p-3', cardHover)}
      data-testid={`milestone-${milestone.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-dense text-text">{milestone.name}</span>
        <span className="text-2xs text-faint tabular">
          {milestone.completed}/{milestone.scope} · {formatDate(milestone.targetDate)}
        </span>
      </div>
      {milestone.description.length === 0 ? null : (
        <p className="text-muted text-xs">{milestone.description}</p>
      )}
      <ProgressBar
        completed={milestone.completed}
        scope={milestone.scope}
        label={`${milestone.name} completion`}
      />
      {canManage ? (
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Move ${milestone.name} up`}
            data-testid={`milestone-up-${milestone.id}`}
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronUp className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Move ${milestone.name} down`}
            data-testid={`milestone-down-${milestone.id}`}
            disabled={busy || index === total - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Edit ${milestone.name}`}
            data-testid={`milestone-edit-${milestone.id}`}
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Delete ${milestone.name}`}
            data-testid={`milestone-delete-${milestone.id}`}
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function MilestoneBoard({ projectId, milestones, canManage }: MilestoneBoardProps) {
  const query = useMilestones(projectId);
  const create = useCreateMilestone(projectId);
  const update = useUpdateMilestone(projectId);
  const remove = useDeleteMilestone(projectId);
  const reorder = useReorderMilestones(projectId);

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<MilestoneFormValues>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MilestoneFormValues>(EMPTY_FORM);

  const rows = query.data ?? milestones;
  const busy = create.isPending || update.isPending || remove.isPending || reorder.isPending;

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    const moving = rows[index];
    const swapped = rows[target];
    if (moving === undefined || swapped === undefined) return;
    const next = rows.map((entry) => entry.id);
    next[index] = swapped.id;
    next[target] = moving.id;
    reorder.mutate(next);
  }

  return (
    <section className="flex flex-col gap-3" data-testid="milestone-board">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-dense text-text">Milestones</h2>
        {canManage && !adding ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="milestone-add"
            onClick={() => {
              setAddDraft(EMPTY_FORM);
              setAdding(true);
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add milestone
          </Button>
        ) : null}
      </div>

      {adding ? (
        <MilestoneForm
          values={addDraft}
          onChange={setAddDraft}
          onCancel={() => setAdding(false)}
          pending={create.isPending}
          submitLabel="Add milestone"
          testId="milestone-new"
          onSubmit={() => {
            create.mutate(milestonePayload(addDraft), {
              onSuccess: () => {
                setAddDraft(EMPTY_FORM);
                setAdding(false);
              },
            });
          }}
        />
      ) : null}

      {rows.length === 0 && !adding ? (
        <p className="text-faint text-xs">No milestones yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((milestone, index) =>
            editingId === milestone.id ? (
              <li
                key={milestone.id}
                className="rounded-lg border border-border p-3"
                data-testid={`milestone-editor-${milestone.id}`}
              >
                <MilestoneForm
                  values={editDraft}
                  onChange={setEditDraft}
                  onCancel={() => setEditingId(null)}
                  pending={update.isPending}
                  submitLabel="Save milestone"
                  testId="milestone-edit"
                  onSubmit={() => {
                    update.mutate(
                      { id: milestone.id, patch: milestonePayload(editDraft) },
                      { onSuccess: () => setEditingId(null) },
                    );
                  }}
                />
              </li>
            ) : (
              <MilestoneRow
                key={milestone.id}
                milestone={milestone}
                canManage={canManage}
                index={index}
                total={rows.length}
                busy={busy}
                onEdit={() => {
                  setEditDraft(draftFrom(milestone));
                  setEditingId(milestone.id);
                }}
                onDelete={() => remove.mutate(milestone.id)}
                onMove={(direction) => move(index, direction)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
