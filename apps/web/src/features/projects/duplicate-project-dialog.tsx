'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { invalidateBootstrap } from '@/lib/query/bootstrap-cache.ts';

const duplicatedSchema = z.object({
  project: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
});

export interface DuplicateProjectDialogProps {
  readonly projectId: string;
  readonly projectName: string;
  readonly canManage: boolean;
  readonly trigger?: ReactNode;
}

export function DuplicateProjectDialog({
  projectId,
  projectName,
  canManage,
  trigger,
}: DuplicateProjectDialogProps) {
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${projectName} (copy)`);
  const [shiftDays, setShiftDays] = useState('0');
  const [includeIssues, setIncludeIssues] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) {
      setName(`${projectName} (copy)`);
      setShiftDays('0');
      setIncludeIssues(true);
      setError(null);
    }
    setOpen(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const parsedShiftDays = Number.parseInt(shiftDays, 10);
      const normalizedShiftDays = Number.isNaN(parsedShiftDays) ? 0 : parsedShiftDays;
      const result = await apiRequest<unknown>(`/api/projects/${projectId}/duplicate`, {
        method: 'POST',
        body: {
          name: name.trim() === '' ? undefined : name.trim(),
          shiftDays: normalizedShiftDays,
          includeIssues,
        },
      });
      const { project } = duplicatedSchema.parse(result);
      invalidateBootstrap(client);
      toast({ title: `Duplicated "${project.name}"`, tone: 'success' });
      setOpen(false);
      router.push(`/projects/${project.slug}`);
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger === undefined ? (
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="ghost" data-testid="duplicate-project-trigger">
            <Copy className="size-4" aria-hidden="true" />
            Duplicate
          </Button>
        </DialogTrigger>
      ) : (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      )}

      <DialogContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Duplicate project</DialogTitle>
            <DialogDescription>
              Copy this project with optional issues and shifted dates.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="duplicate-project-name" className="text-dense text-muted">
              Project name
            </label>
            <Input
              id="duplicate-project-name"
              type="text"
              value={name}
              required
              maxLength={120}
              data-testid="duplicate-project-name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="duplicate-project-shift-days" className="text-dense text-muted">
              Shift dates by calendar days
            </label>
            <Input
              id="duplicate-project-shift-days"
              type="number"
              value={shiftDays}
              min={-3650}
              max={3650}
              data-testid="duplicate-project-shift-days"
              onChange={(event) => setShiftDays(event.target.value)}
            />
            <span className="text-2xs text-faint">
              Use positive numbers to push dates into the future, or negative to pull them back.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="duplicate-project-include-issues"
              type="checkbox"
              checked={includeIssues}
              data-testid="duplicate-project-include-issues"
              onChange={(event) => setIncludeIssues(event.target.checked)}
            />
            <label htmlFor="duplicate-project-include-issues" className="text-dense text-muted">
              Include issues
            </label>
          </div>

          {error === null ? null : (
            <p
              className="text-danger text-dense"
              data-testid="duplicate-project-error"
              role="alert"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending}
              data-testid="duplicate-project-submit"
            >
              {pending ? 'Duplicating...' : 'Duplicate project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
