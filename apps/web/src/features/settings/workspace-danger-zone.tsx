'use client';

import { formatBytes } from '@orbit/shared/utils';
import {
  type OrganizationDeletionResponse,
  type OrganizationDeletionSummary,
  organizationDeletionResponseSchema,
  organizationDeletionSummaryResponseSchema,
} from '@orbit/shared/validators';
import { useEffect, useRef, useState } from 'react';
import { ZodError } from 'zod';
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
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';

export function formatDeletionBytes(bytes: number): string {
  return formatBytes(bytes);
}

function quantity(total: number, singular: string): string {
  return `${total} ${total === 1 ? singular : `${singular}s`}`;
}

function payloadError(error: unknown): string {
  if (error instanceof ZodError) return 'The deletion summary could not be read. Try again.';
  return messageOf(error);
}

function dangerDescription(pending: boolean): string {
  if (pending) {
    return 'Deletion is in progress. Retry the permanent cleanup until every workspace record and file is removed.';
  }
  return 'Permanently delete this workspace and everything stored inside it. This cannot be undone.';
}

function permanentDeletionLabel(pending: boolean, deleting: boolean): string {
  if (deleting) return 'Deleting workspace';
  if (pending) return 'Retry permanent deletion';
  return 'Permanently delete workspace';
}

function dangerActionLabel(pending: boolean): string {
  return pending ? 'Retry workspace deletion' : 'Delete workspace';
}

function PendingDeletionNotice({ pending }: { readonly pending: boolean }) {
  if (!pending) return null;
  return (
    <p role="status" className="rounded-md bg-warning/10 p-3 text-warning text-xs">
      This workspace is locked for normal use while permanent deletion is pending. A retry safely
      resumes the idempotent cleanup.
    </p>
  );
}

interface WorkspaceDangerZoneProps {
  readonly organizationName: string;
  readonly deletionRequestedAt?: string | null;
}

export function WorkspaceDangerZone({
  organizationName,
  deletionRequestedAt = null,
}: WorkspaceDangerZoneProps) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<OrganizationDeletionSummary | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const requestId = useRef(0);
  const deletingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const availableAt = summary?.availableAt ?? null;
  const currentName = summary?.organizationName ?? organizationName;
  const pending = (summary?.deletionRequestedAt ?? deletionRequestedAt) !== null;
  const blocked = pending && availableAt !== null && Date.parse(availableAt) > clock;
  const canDelete =
    summary !== null && !loading && !blocked && !deleting && confirmation === currentName;

  useEffect(() => {
    if (availableAt === null) return;
    const remaining = Date.parse(availableAt) - Date.now();
    if (remaining <= 0) {
      setClock(Date.now());
      return;
    }
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(remaining + 25, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [availableAt]);

  async function loadSummary(): Promise<void> {
    const activeRequest = requestId.current + 1;
    requestId.current = activeRequest;
    setLoading(true);
    setSummary(null);
    setError(null);
    try {
      const payload = await apiRequest<unknown>('/api/organizations/current/deletion');
      if (requestId.current !== activeRequest) return;
      const parsed = organizationDeletionSummaryResponseSchema.parse(payload);
      setSummary(parsed.summary);
      setClock(Date.now());
    } catch (caught) {
      if (requestId.current !== activeRequest) return;
      setError(payloadError(caught));
    } finally {
      if (requestId.current === activeRequest) setLoading(false);
    }
  }

  function showDialog(): void {
    setOpen(true);
    setConfirmation('');
    setError(null);
    loadSummary().catch(() => undefined);
  }

  function closeDialog(): void {
    if (deletingRef.current) return;
    requestId.current += 1;
    setOpen(false);
    setSummary(null);
    setConfirmation('');
    setError(null);
  }

  async function confirmDeletion(): Promise<void> {
    if (!canDelete || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    let deleted: OrganizationDeletionResponse;
    try {
      const payload = await apiRequest<unknown>('/api/organizations/current/deletion', {
        method: 'DELETE',
        body: { confirmation },
      });
      deleted = organizationDeletionResponseSchema.parse(payload);
    } catch (caught) {
      const nextError = payloadError(caught);
      deletingRef.current = false;
      setDeleting(false);
      await loadSummary();
      setError(nextError);
      return;
    }
    if (deleted.nextOrganizationId === null) {
      window.location.assign('/workspaces/new');
      return;
    }
    try {
      const activated = await authClient.organization.setActive({
        organizationId: deleted.nextOrganizationId,
      });
      if (activated.error) {
        window.location.assign('/workspaces/new');
        return;
      }
      window.location.assign('/my-issues');
    } catch {
      window.location.assign('/workspaces/new');
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-danger/40 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-danger text-dense">Danger zone</h3>
        <p className="text-muted text-xs">{dangerDescription(pending)}</p>
      </div>
      <div>
        <Button variant="danger" onClick={showDialog}>
          {dangerActionLabel(pending)}
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) closeDialog();
        }}
      >
        <DialogContent
          ref={dialogRef}
          tabIndex={-1}
          showClose={!deleting}
          className="max-w-md"
          aria-busy={loading || deleting}
          onEscapeKeyDown={(event) => {
            if (deleting) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deleting) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            queueMicrotask(() => dialogRef.current?.focus());
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-medium text-base text-text">
              Delete {currentName}?
            </DialogTitle>
            <DialogDescription className="text-muted text-xs">
              This permanently removes the workspace for every member. Review the impact, then type
              its exact name to continue.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p role="status" className="text-muted text-xs">
              Calculating everything that will be deleted...
            </p>
          ) : null}

          {summary === null ? null : (
            <div className="flex flex-col gap-4">
              <PendingDeletionNotice pending={pending} />
              <ul
                aria-label="Workspace contents that will be deleted"
                className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-surface-2 p-3 text-dense text-text"
              >
                <li>{quantity(summary.members, 'member')}</li>
                <li>{quantity(summary.teams, 'team')}</li>
                <li>{quantity(summary.projects, 'project')}</li>
                <li>{quantity(summary.issues, 'issue')}</li>
                <li>{quantity(summary.documents, 'document')}</li>
                <li className="flex flex-wrap gap-1">
                  <span>{quantity(summary.files, 'file')}</span>
                  <span className="text-faint">{formatDeletionBytes(summary.fileBytes)}</span>
                </li>
                {summary.fileVersions > summary.files ||
                summary.fileVersionBytes > summary.fileBytes ? (
                  <li className="flex flex-wrap gap-1">
                    <span>{quantity(summary.fileVersions, 'stored file version')}</span>
                    <span className="text-faint">
                      {formatDeletionBytes(summary.fileVersionBytes)}
                    </span>
                  </li>
                ) : null}
                <li>{quantity(summary.integrations, 'integration')}</li>
                <li>{quantity(summary.webhooks, 'webhook')}</li>
              </ul>

              <details className="rounded-md border border-border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-text">
                  Comments, attachments, activity and settings
                </summary>
                <p className="pt-2 text-muted">
                  Nested comments, issue relations, document history, stored file versions,
                  notifications, saved views, cycles, labels, workflow states, credentials and other
                  workspace-owned records are deleted with their parent data.
                </p>
              </details>

              {blocked && availableAt !== null ? (
                <p role="status" className="rounded-md bg-warning/10 p-3 text-warning text-xs">
                  Deletion becomes available after pending upload links and their completion window
                  close at{' '}
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(availableAt))}
                  .
                </p>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="workspace-delete-confirmation"
                  className="font-medium text-text text-xs"
                >
                  Type {currentName} to confirm
                </label>
                <Input
                  id="workspace-delete-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  maxLength={80}
                  disabled={deleting}
                />
              </div>
            </div>
          )}

          {error === null ? null : (
            <div role="alert" className="mt-3 rounded-md bg-danger/10 p-3 text-danger text-xs">
              <p>{error}</p>
              {summary === null && !loading ? (
                <Button className="mt-2" size="sm" variant="secondary" onClick={loadSummary}>
                  Retry
                </Button>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" disabled={deleting} onClick={closeDialog}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!canDelete} onClick={confirmDeletion}>
              {permanentDeletionLabel(pending, deleting)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
