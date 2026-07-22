'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import type { MemberView, TeamDetail } from './data.ts';

export interface TeamsPanelProps {
  readonly teams: readonly TeamDetail[];
  readonly members: readonly MemberView[];
  readonly canManage: boolean;
}

export function TeamsPanel({ teams, members, canManage }: TeamsPanelProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function run(teamId: string | null, action: () => Promise<unknown>): Promise<void> {
    setBusyTeamId(teamId);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyTeamId(null);
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest('/api/teams', { method: 'POST', body: { name, key } });
      setName('');
      setKey('');
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  function toggleMembership(team: TeamDetail, userId: string): Promise<void> {
    const isMember = team.memberIds.includes(userId);
    return run(team.id, () =>
      isMember
        ? apiRequest(`/api/teams/${team.id}/members/${userId}`, { method: 'DELETE' })
        : apiRequest(`/api/teams/${team.id}/members`, { method: 'POST', body: { userId } }),
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={onCreate}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <label htmlFor="team-name" className="flex flex-1 flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Team name</span>
          <Input
            id="team-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={64}
            placeholder="Design"
            disabled={!canManage || pending}
            name="teamName"
          />
        </label>
        <label htmlFor="team-key" className="flex w-32 flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Key</span>
          <Input
            id="team-key"
            value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
            required
            pattern="[A-Z][A-Z0-9]{1,5}"
            title="2 to 6 uppercase letters or digits"
            placeholder="DES"
            disabled={!canManage || pending}
            name="teamKey"
          />
        </label>
        <Button type="submit" variant="primary" disabled={!canManage || pending}>
          {pending ? 'Creating' : 'Create team'}
        </Button>
      </form>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {teams.map((team) => (
          <li key={team.id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Badge tone="accent">{team.key}</Badge>
                {editingId === team.id ? (
                  <Input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="h-7 w-48 text-xs"
                    aria-label={`Rename ${team.name}`}
                  />
                ) : (
                  <span className="font-medium text-dense text-text">{team.name}</span>
                )}
                {team.archivedAt === null ? null : <Badge tone="neutral">Archived</Badge>}
              </span>
              <span className="flex items-center gap-1">
                {editingId === team.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyTeamId === team.id}
                      onClick={() =>
                        run(team.id, async () => {
                          await apiRequest(`/api/teams/${team.id}`, {
                            method: 'PATCH',
                            body: { name: editName },
                          });
                          setEditingId(null);
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canManage}
                    onClick={() => {
                      setEditingId(team.id);
                      setEditName(team.name);
                    }}
                  >
                    Rename
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canManage || team.archivedAt !== null || busyTeamId === team.id}
                  onClick={() =>
                    run(team.id, () => apiRequest(`/api/teams/${team.id}`, { method: 'DELETE' }))
                  }
                >
                  Archive
                </Button>
              </span>
            </div>

            <fieldset disabled={!canManage} className="flex flex-wrap gap-x-4 gap-y-2">
              <legend className="mb-1 text-faint text-2xs uppercase">Membership</legend>
              {members.map((member) => (
                <label
                  key={member.userId}
                  htmlFor={`team-${team.id}-member-${member.userId}`}
                  className="flex items-center gap-1.5 text-muted text-xs"
                >
                  <Checkbox
                    id={`team-${team.id}-member-${member.userId}`}
                    checked={team.memberIds.includes(member.userId)}
                    onCheckedChange={() => toggleMembership(team, member.userId)}
                    aria-label={`${member.name} on ${team.name}`}
                  />
                  <Avatar name={member.name} src={member.image} size="xs" />
                  {member.name}
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ul>
    </div>
  );
}
