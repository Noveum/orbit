'use client';

import { CheckCheck, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
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
import {
  useCompleteSprint,
  useCreateSprint,
  useDeleteSprint,
  useStartSprint,
  useUpdateSprint,
} from '@/lib/query/use-sprints.ts';

export interface SprintSummary {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface SprintFormValues {
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly shiftFollowing: boolean;
}

const EMPTY_FORM: SprintFormValues = {
  name: '',
  startsAt: '',
  endsAt: '',
  shiftFollowing: false,
};

const DURATIONS = [1, 2, 3, 4] as const;

const DAY = 86_400_000;

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function formOf(sprint: SprintSummary): SprintFormValues {
  return {
    name: sprint.name,
    startsAt: utcDay(sprint.startsAt),
    endsAt: utcDay(sprint.endsAt),
    shiftFollowing: false,
  };
}

export function endAfterWeeks(startsAt: string, weeks: number): string {
  const start = Date.parse(`${startsAt}T00:00:00.000Z`);
  if (Number.isNaN(start)) return '';
  return new Date(start + weeks * 7 * DAY).toISOString().slice(0, 10);
}

export function weeksBetween(startsAt: string, endsAt: string): number | null {
  const start = Date.parse(`${startsAt}T00:00:00.000Z`);
  const end = Date.parse(`${endsAt}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const days = Math.round((end - start) / DAY);
  return days > 0 && days % 7 === 0 ? days / 7 : null;
}

interface SprintDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly initial: SprintFormValues;
  readonly pending: boolean;
  readonly testId: string;
  readonly offerShift: boolean;
  readonly onSubmit: (values: SprintFormValues) => void;
}

function SprintDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initial,
  pending,
  testId,
  offerShift,
  onSubmit,
}: SprintDialogProps) {
  const [values, setValues] = useState(initial);
  const weeks = weeksBetween(values.startsAt, values.endsAt);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      name: values.name.trim(),
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      shiftFollowing: values.shiftFollowing,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">{title}</DialogTitle>
          <DialogDescription className="text-muted text-xs">{description}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={submit}>
          <label className="flex flex-col gap-1.5 text-2xs text-faint" htmlFor={`${testId}-name`}>
            Name
            <Input
              id={`${testId}-name`}
              autoFocus
              maxLength={120}
              value={values.name}
              data-testid={`${testId}-name`}
              placeholder="Sprint 12"
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label
              className="flex flex-col gap-1.5 text-2xs text-faint"
              htmlFor={`${testId}-starts`}
            >
              Starts
              <Input
                id={`${testId}-starts`}
                type="date"
                value={values.startsAt}
                data-testid={`${testId}-starts`}
                onChange={(event) => setValues({ ...values, startsAt: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-2xs text-faint" htmlFor={`${testId}-ends`}>
              Ends
              <Input
                id={`${testId}-ends`}
                type="date"
                value={values.endsAt}
                data-testid={`${testId}-ends`}
                onChange={(event) => setValues({ ...values, endsAt: event.target.value })}
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-2xs text-faint">Duration</legend>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((count) => (
                <Button
                  key={count}
                  type="button"
                  size="sm"
                  variant={weeks === count ? 'secondary' : 'ghost'}
                  disabled={values.startsAt.length === 0}
                  data-testid={`${testId}-weeks-${count}`}
                  onClick={() =>
                    setValues({ ...values, endsAt: endAfterWeeks(values.startsAt, count) })
                  }
                >
                  {count} {count === 1 ? 'week' : 'weeks'}
                </Button>
              ))}
            </div>
          </fieldset>

          {offerShift ? (
            <label className="flex items-center gap-2 text-2xs text-muted">
              <input
                type="checkbox"
                checked={values.shiftFollowing}
                data-testid={`${testId}-shift`}
                onChange={(event) => setValues({ ...values, shiftFollowing: event.target.checked })}
              />
              Move later sprints by the same amount
            </label>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending}
              data-testid={`${testId}-submit`}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly tone: 'primary' | 'danger';
  readonly pending: boolean;
  readonly testId: string;
  readonly onConfirm: () => void;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone,
  pending,
  testId,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">{title}</DialogTitle>
          <DialogDescription className="text-muted text-xs">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={tone}
            disabled={pending}
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function draftFrom(values: SprintFormValues) {
  return {
    ...(values.name.length === 0 ? {} : { name: values.name }),
    ...(values.startsAt.length === 0 ? {} : { startsAt: values.startsAt }),
    ...(values.endsAt.length === 0 ? {} : { endsAt: values.endsAt }),
  };
}

function movedDay(day: string, was: string): boolean {
  return day.length > 0 && day !== was;
}

function editFrom(sprint: SprintSummary, values: SprintFormValues) {
  const before = formOf(sprint);
  const endMoved = movedDay(values.endsAt, before.endsAt);
  return {
    id: sprint.id,
    ...(values.name === before.name ? {} : { name: values.name }),
    ...(movedDay(values.startsAt, before.startsAt) ? { startsAt: values.startsAt } : {}),
    ...(endMoved ? { endsAt: values.endsAt } : {}),
    ...(endMoved && values.shiftFollowing ? { shiftFollowing: true } : {}),
  };
}

export function NewSprintButton() {
  const [open, setOpen] = useState(false);
  const create = useCreateSprint();

  return (
    <>
      <Button size="sm" data-testid="sprint-new" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden="true" />
        New sprint
      </Button>
      {open ? (
        <SprintDialog
          open={open}
          onOpenChange={setOpen}
          title="New sprint"
          description="Leave the dates empty and Orbit adds a two week sprint straight after the last one."
          submitLabel="Create sprint"
          initial={EMPTY_FORM}
          pending={create.isPending}
          testId="sprint-create-dialog"
          offerShift={false}
          onSubmit={(values) => {
            create.mutate(draftFrom(values), { onSuccess: () => setOpen(false) });
          }}
        />
      ) : null}
    </>
  );
}

export function EditSprintButton({ sprint }: { readonly sprint: SprintSummary }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateSprint();

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        data-testid={`sprint-edit-${sprint.id}`}
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        Edit
      </Button>
      {open ? (
        <SprintDialog
          open={open}
          onOpenChange={setOpen}
          title={`Edit ${sprint.name}`}
          description="Rename the sprint or move its dates. Sprints on a team may not overlap."
          submitLabel="Save sprint"
          initial={formOf(sprint)}
          pending={update.isPending}
          testId="sprint-edit-dialog"
          offerShift={true}
          onSubmit={(values) => {
            update.mutate(editFrom(sprint, values), { onSuccess: () => setOpen(false) });
          }}
        />
      ) : null}
    </>
  );
}

export function StartSprintButton({ sprint }: { readonly sprint: SprintSummary }) {
  const start = useStartSprint();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={start.isPending}
      data-testid={`sprint-start-${sprint.id}`}
      onClick={() => start.mutate(sprint.id)}
    >
      <Play className="size-3.5" aria-hidden="true" />
      Start
    </Button>
  );
}

export function CompleteSprintButton({ sprint }: { readonly sprint: SprintSummary }) {
  const [open, setOpen] = useState(false);
  const complete = useCompleteSprint();

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        data-testid={`sprint-complete-${sprint.id}`}
        onClick={() => setOpen(true)}
      >
        <CheckCheck className="size-3.5" aria-hidden="true" />
        Complete sprint
      </Button>
      {open ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={`Complete ${sprint.name}`}
          description="Everything still open rolls into the next sprint, and what shipped is recorded against this one."
          confirmLabel="Complete sprint"
          tone="primary"
          pending={complete.isPending}
          testId="sprint-complete-dialog"
          onConfirm={() => {
            complete.mutate(sprint.id, { onSuccess: () => setOpen(false) });
          }}
        />
      ) : null}
    </>
  );
}

export function DeleteSprintButton({ sprint }: { readonly sprint: SprintSummary }) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteSprint();

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Delete ${sprint.name}`}
        data-testid={`sprint-delete-${sprint.id}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
      {open ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={`Delete ${sprint.name}`}
          description="The sprint goes, its issues stay and fall back to no sprint."
          confirmLabel="Delete sprint"
          tone="danger"
          pending={remove.isPending}
          testId="sprint-delete-dialog"
          onConfirm={() => {
            remove.mutate(sprint.id, { onSuccess: () => setOpen(false) });
          }}
        />
      ) : null}
    </>
  );
}
