'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { z } from 'zod';
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
import { Textarea } from '@/components/ui/textarea.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import type { ProjectTeamOption } from './project-settings-form.tsx';

const createdSchema = z.object({
  project: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
});

export interface NewProjectDialogProps {
  readonly teams: readonly ProjectTeamOption[];
  readonly canManage: boolean;
  readonly label?: string;
}

const EMPTY_DRAFT = { name: '', summary: '', targetDate: '' };

export function NewProjectDialog({
  teams,
  canManage,
  label = 'New project',
}: NewProjectDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [teamIds, setTeamIds] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  function reset(): void {
    setDraft(EMPTY_DRAFT);
    setTeamIds([]);
    setError(null);
  }

  function toggleTeam(id: string): void {
    setTeamIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await apiRequest<unknown>('/api/projects', {
        method: 'POST',
        body: {
          name: draft.name.trim(),
          summary: draft.summary.trim(),
          teamIds: [...teamIds],
          targetDate: draft.targetDate.length === 0 ? null : draft.targetDate,
        },
      });
      const { project } = createdSchema.parse(created);
      toast({ title: `Created "${project.name}"`, tone: 'success' });
      setOpen(false);
      reset();
      router.push(`/projects/${project.slug}`);
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="primary"
        data-testid="new-project"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {label}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent data-testid="new-project-dialog">
          <DialogHeader>
            <DialogTitle className="font-medium text-base text-text">New project</DialogTitle>
            <DialogDescription className="text-muted text-xs">
              A project groups issues around an outcome, with milestones and a health signal.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <label
              className="flex flex-col gap-1.5 text-2xs text-faint"
              htmlFor="new-project-name-field"
            >
              Name
              <Input
                id="new-project-name-field"
                autoFocus
                required
                minLength={2}
                maxLength={120}
                value={draft.name}
                data-testid="new-project-name"
                placeholder="Realtime delta protocol"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label
              className="flex flex-col gap-1.5 text-2xs text-faint"
              htmlFor="new-project-summary-field"
            >
              Summary
              <Textarea
                id="new-project-summary-field"
                rows={2}
                maxLength={500}
                value={draft.summary}
                data-testid="new-project-summary"
                placeholder="One line on what done looks like."
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
              />
            </label>

            <label
              className="flex flex-col gap-1.5 text-2xs text-faint"
              htmlFor="new-project-target-field"
            >
              Target date
              <Input
                id="new-project-target-field"
                type="date"
                value={draft.targetDate}
                data-testid="new-project-target"
                onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
              />
            </label>

            {teams.length === 0 ? null : (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-2xs text-faint">Teams</legend>
                <div className="flex flex-wrap gap-2">
                  {teams.map((team) => (
                    <label
                      key={team.id}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-dense text-muted"
                    >
                      <input
                        type="checkbox"
                        checked={teamIds.includes(team.id)}
                        data-testid={`new-project-team-${team.key}`}
                        onChange={() => toggleTeam(team.id)}
                      />
                      {team.name}
                    </label>
                  ))}
                </div>
                <p className="text-2xs text-faint">
                  Leave every team unticked to make the project visible to the whole workspace.
                </p>
              </fieldset>
            )}

            {error === null ? null : (
              <p role="alert" className="text-danger text-dense" data-testid="new-project-error">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                data-testid="new-project-submit"
                disabled={pending || draft.name.trim().length < 2}
              >
                {pending ? 'Creating' : 'Create project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
