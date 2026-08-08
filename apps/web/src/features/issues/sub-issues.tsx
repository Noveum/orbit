'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { useCreateIssue, useUpdateIssue } from '@/lib/query/use-issues.ts';
import { IssuePicker } from './issue-picker.tsx';

export interface SubIssuesProps {
  readonly issue: Issue;
  readonly subIssues: readonly Issue[];
}

export function SubIssues({ issue, subIssues }: SubIssuesProps) {
  const create = useCreateIssue(issue.teamId);
  const update = useUpdateIssue();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0 || create.isPending) return;
    create.mutate(
      {
        teamId: issue.teamId,
        title: trimmed,
        description: '',
        priority: 0,
        assigneeId: null,
        projectId: issue.projectId,
        cycleId: issue.cycleId,
        parentId: issue.id,
        estimate: null,
        labelIds: [],
      },
      {
        onSuccess: () => {
          setTitle('');
          setAdding(false);
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-1" data-testid="sub-issues">
      <div className="flex items-center gap-2">
        <h2 className="text-2xs text-faint uppercase tracking-wide">Sub issues</h2>
        <div className="ml-auto flex items-center gap-1">
          <IssuePicker
            open={linking}
            onOpenChange={setLinking}
            excludedIds={[issue.id, ...subIssues.map((child) => child.id)]}
            testId="sub-issue-picker"
            placeholder="Search for an existing issue"
            onPick={(picked) => update.mutate({ issue: picked, patch: { parentId: issue.id } })}
          >
            <Button size="sm" variant="ghost" data-testid="link-sub-issue">
              Link existing
            </Button>
          </IssuePicker>
          <Button
            size="sm"
            variant="ghost"
            data-testid="add-sub-issue"
            onClick={() => setAdding((open) => !open)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      {subIssues.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {subIssues.map((child) => (
            <li key={child.id}>
              <Link
                href={`/issue/${child.identifier}`}
                className={cn('flex items-center gap-2 px-2.5 py-1.5 text-dense', rowHover)}
              >
                <span data-numeric className="text-2xs text-faint">
                  {child.identifier}
                </span>
                <span className="truncate text-text">{child.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="flex items-center gap-2 pt-1" onSubmit={submit}>
          <Input
            autoFocus
            value={title}
            aria-label="Sub issue title"
            placeholder="What needs doing?"
            data-testid="sub-issue-title"
            onChange={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              setTitle('');
              setAdding(false);
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            data-testid="sub-issue-submit"
            disabled={create.isPending || title.trim().length === 0}
          >
            Create
          </Button>
        </form>
      ) : null}
    </section>
  );
}
