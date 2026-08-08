'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
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
import type { MemberView, TeamDetail } from './data.ts';

export interface TeamSettingsPanelProps {
  readonly team: TeamDetail;
  readonly members: readonly MemberView[];
  readonly canManage: boolean;
}

export function TeamSettingsPanel({ team, members, canManage }: TeamSettingsPanelProps) {
  const router = useRouter();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const archived = team.archivedAt !== null;
  const unchanged = name.trim() === team.name && description.trim() === team.description;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await run(() =>
      apiRequest(`/api/teams/${team.id}`, {
        method: 'PATCH',
        body: { name: name.trim(), description: description.trim() },
      }),
    );
  }

  function toggleMembership(userId: string): Promise<void> {
    const isMember = team.memberIds.includes(userId);
    return run(() =>
      isMember
        ? apiRequest(`/api/teams/${team.id}/members/${userId}`, { method: 'DELETE' })
        : apiRequest(`/api/teams/${team.id}/members`, { method: 'POST', body: { userId } }),
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid={`team-settings-${team.key}`}>
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <form onSubmit={onSave} className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <label htmlFor="team-settings-name" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Name</span>
          <Input
            id="team-settings-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={64}
            disabled={!canManage || busy}
          />
        </label>
        <label htmlFor="team-settings-description" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Description</span>
          <Input
            id="team-settings-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={280}
            placeholder="What this team owns"
            disabled={!canManage || busy}
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted text-xs">
            The key <Badge tone="accent">{team.key}</Badge> prefixes every issue identifier and
            cannot be changed.
          </p>
          <Button type="submit" variant="primary" disabled={!canManage || busy || unchanged}>
            {busy ? 'Saving' : 'Save'}
          </Button>
        </div>
      </form>

      <fieldset
        disabled={!canManage || busy}
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <legend className="font-medium text-dense text-text">Members</legend>
        <p className="text-muted text-xs">
          Only members of this team are assigned its issues by default.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {members.map((member) => (
            <label
              key={member.userId}
              htmlFor={`team-member-${member.userId}`}
              className="flex items-center gap-1.5 text-muted text-xs"
            >
              <Checkbox
                id={`team-member-${member.userId}`}
                checked={team.memberIds.includes(member.userId)}
                onCheckedChange={() => toggleMembership(member.userId)}
                aria-label={`${member.name} on ${team.name}`}
              />
              <Avatar name={member.name} src={member.image} size="xs" />
              {member.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <span className="font-medium text-dense text-text">
          {archived ? 'Archived team' : 'Archive team'}
        </span>
        <p className="text-muted text-xs">
          {archived
            ? 'This team is hidden from the sidebar and from every team picker. Its issues are untouched, and restoring brings it back exactly as it was.'
            : 'Archiving hides the team from the sidebar and from every team picker. Nothing is deleted, and you can restore it here afterwards.'}
        </p>
        <div>
          {archived ? (
            <Button
              variant="secondary"
              disabled={!canManage || busy}
              data-testid="restore-team"
              onClick={() =>
                run(() => apiRequest(`/api/teams/${team.id}/restore`, { method: 'POST' }))
              }
            >
              Restore team
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={!canManage || busy}
              data-testid="archive-team"
              onClick={() => setConfirmingArchive(true)}
            >
              Archive team
            </Button>
          )}
        </div>
      </div>

      <Dialog open={confirmingArchive} onOpenChange={setConfirmingArchive}>
        <DialogContent className="max-w-sm" data-testid="archive-team-dialog">
          <DialogHeader>
            <DialogTitle className="font-medium text-base text-text">
              Archive {team.name}?
            </DialogTitle>
            <DialogDescription className="text-muted text-xs">
              It disappears from the sidebar and every team picker. Its issues stay where they are,
              and you can restore the team from this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingArchive(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-archive-team"
              onClick={() => {
                setConfirmingArchive(false);
                run(() => apiRequest(`/api/teams/${team.id}`, { method: 'DELETE' })).catch(
                  () => undefined,
                );
              }}
            >
              Archive team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
