'use client';

import type { DocAccessLevel } from '@orbit/shared/constants';
import { Check, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { messageOf } from '@/lib/query/fetcher.ts';
import type { DocGrant } from '@/lib/query/use-doc-access.ts';
import { useDocAccess, useSetDocAccess } from '@/lib/query/use-doc-access.ts';

interface Candidate {
  readonly subjectType: 'user' | 'team';
  readonly subjectId: string;
  readonly name: string;
  readonly image: string | null;
}

function levelLabel(level: DocAccessLevel): string {
  return level === 'write' ? 'Can edit' : 'Can view';
}

export function DocPeopleAccess({ docId, canManage }: { docId: string; canManage: boolean }) {
  const workspace = useWorkspace();
  const { toast } = useToast();
  const access = useDocAccess(docId, canManage);
  const save = useSetDocAccess(docId);
  const [search, setSearch] = useState('');

  const grants: DocGrant[] = useMemo(
    () =>
      (access.data?.grants ?? []).map((grant) => ({
        subjectType: grant.subjectType,
        subjectId: grant.subjectId,
        level: grant.level,
      })),
    [access.data],
  );

  const candidates = useMemo<Candidate[]>(() => {
    const people: Candidate[] = workspace.members.map((member) => ({
      subjectType: 'user',
      subjectId: member.id,
      name: member.name,
      image: member.image,
    }));
    const teams: Candidate[] = workspace.teams.map((team) => ({
      subjectType: 'team',
      subjectId: team.id,
      name: team.name,
      image: null,
    }));
    return [...people, ...teams];
  }, [workspace.members, workspace.teams]);

  const nameOf = (grant: DocGrant): string =>
    candidates.find(
      (entry) => entry.subjectType === grant.subjectType && entry.subjectId === grant.subjectId,
    )?.name ?? 'Someone who has left';

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return [];
    return candidates
      .filter((entry) => entry.name.toLowerCase().includes(needle))
      .filter(
        (entry) =>
          !grants.some(
            (grant) =>
              grant.subjectType === entry.subjectType && grant.subjectId === entry.subjectId,
          ),
      )
      .slice(0, 6);
  }, [candidates, grants, search]);

  function commit(next: readonly DocGrant[]): void {
    save.mutate(next, {
      onError: (error: unknown) =>
        toast({ title: 'Could not save sharing', description: messageOf(error), tone: 'danger' }),
    });
  }

  if (!canManage) {
    return (
      <p className="text-2xs text-faint">
        Only the author or a workspace admin can change who this doc is shared with.
      </p>
    );
  }

  if (access.isPending) {
    return <p className="text-2xs text-faint">Loading who this is shared with…</p>;
  }

  if (access.isError) {
    return (
      <p className="text-2xs text-danger" data-testid="doc-access-error">
        Could not load who this is shared with. Close this and try again.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="doc-people-access">
      <div className="flex flex-col gap-1.5">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Add a person or a team by name"
          data-testid="doc-access-search"
          aria-label="Add a person or a team"
        />
        {shown.length === 0 ? null : (
          <ul className="flex flex-col gap-0.5 rounded-md border border-border bg-surface p-1">
            {shown.map((entry) => (
              <li key={`${entry.subjectType}:${entry.subjectId}`}>
                <button
                  type="button"
                  data-testid={`doc-access-add-${entry.subjectId}`}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-dense text-text transition-colors duration-[var(--duration-instant)] hover:bg-surface-2 motion-reduce:transition-none"
                  onClick={() => {
                    commit([
                      ...grants,
                      {
                        subjectType: entry.subjectType,
                        subjectId: entry.subjectId,
                        level: 'read',
                      },
                    ]);
                    setSearch('');
                  }}
                >
                  {entry.subjectType === 'user' ? (
                    <Avatar name={entry.name} src={entry.image} size="sm" />
                  ) : (
                    <span className="flex size-5.5 items-center justify-center rounded-full bg-surface-3 text-2xs text-muted">
                      T
                    </span>
                  )}
                  <span className="flex-1 truncate">{entry.name}</span>
                  <Plus className="size-3.5 text-faint" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {grants.length === 0 ? (
        <p className="text-2xs text-faint">Nobody has been given access by name yet.</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="doc-access-list">
          {grants.map((grant) => (
            <li
              key={`${grant.subjectType}:${grant.subjectId}`}
              className="flex items-center gap-2 text-dense"
              data-testid={`doc-access-row-${grant.subjectId}`}
            >
              <span className="flex-1 truncate text-text">{nameOf(grant)}</span>
              <button
                type="button"
                className="rounded-sm px-1.5 py-0.5 text-2xs text-muted transition-colors duration-[var(--duration-instant)] hover:bg-surface-2 motion-reduce:transition-none"
                data-testid={`doc-access-level-${grant.subjectId}`}
                onClick={() =>
                  commit(
                    grants.map((entry) =>
                      entry.subjectId === grant.subjectId && entry.subjectType === grant.subjectType
                        ? { ...entry, level: entry.level === 'read' ? 'write' : 'read' }
                        : entry,
                    ),
                  )
                }
              >
                {levelLabel(grant.level)}
              </button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${nameOf(grant)}`}
                data-testid={`doc-access-remove-${grant.subjectId}`}
                className="size-6 px-0"
                onClick={() =>
                  commit(
                    grants.filter(
                      (entry) =>
                        !(
                          entry.subjectId === grant.subjectId &&
                          entry.subjectType === grant.subjectType
                        ),
                    ),
                  )
                }
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {save.isPending ? <p className="text-2xs text-faint">Saving…</p> : null}
      {!save.isPending && save.isSuccess ? (
        <p className="flex items-center gap-1 text-2xs text-muted">
          <Check className="size-3 text-success" aria-hidden="true" />
          Sharing saved
        </p>
      ) : null}
    </div>
  );
}
