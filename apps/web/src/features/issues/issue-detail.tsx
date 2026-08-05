'use client';

import { Bell, BellOff, Check } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { CommentThread } from '@/features/comments/comment-thread.tsx';
import { ViewerPresence } from '@/features/comments/viewer-presence.tsx';
import { RichTextEditor } from '@/features/docs/editor/rich-text-editor.tsx';
import { useAutosave } from '@/features/docs/use-autosave.ts';
import { IssuePullRequests } from '@/features/pulls/issue-pull-requests.tsx';
import { apiFetch, messageOf } from '@/lib/query/fetcher.ts';
import type { Issue, Member } from '@/lib/query/schemas.ts';
import { subscribedSchema } from '@/lib/query/schemas.ts';
import { useComments } from '@/lib/query/use-comments.ts';
import { useIssueDetail, useUpdateIssue } from '@/lib/query/use-issues.ts';
import { IssueProperties } from './issue-properties.tsx';
import { PriorityGlyph } from './priority-glyph.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export interface IssueDetailViewProps {
  readonly identifier: string;
  readonly known?: Issue;
}

export function IssueTitle({
  issue,
  onCommit,
}: {
  readonly issue: Issue;
  readonly onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(issue.title);
  const server = useRef(issue.title);

  useEffect(() => {
    if (server.current === issue.title) return;
    const untouched = draft === server.current;
    server.current = issue.title;
    if (untouched) setDraft(issue.title);
  }, [issue.title, draft]);

  const size = (node: HTMLTextAreaElement | null): undefined => {
    if (node === null) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  };

  const abandoned = useRef(false);

  const commit = () => {
    if (abandoned.current) {
      abandoned.current = false;
      return;
    }
    const next = draft.trim();
    if (next.length === 0) {
      setDraft(issue.title);
      return;
    }
    if (next !== issue.title) onCommit(next);
  };

  return (
    <textarea
      ref={size}
      rows={1}
      value={draft}
      spellCheck={false}
      aria-label="Issue title"
      data-testid="issue-title"
      onChange={(event) => {
        setDraft(event.target.value);
        size(event.currentTarget);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        if (event.key === 'Escape') {
          abandoned.current = true;
          setDraft(issue.title);
          event.currentTarget.blur();
        }
      }}
      className="-mx-1 w-[calc(100%+0.5rem)] resize-none overflow-hidden rounded-md border-0 bg-transparent px-1 font-medium text-text text-xl leading-tight outline-none transition-colors duration-[var(--duration-fast)] placeholder:text-faint hover:bg-surface-2 focus:bg-transparent"
      placeholder="Issue title"
    />
  );
}

function IssueBody({
  issue,
  members,
  onCommit,
}: {
  readonly issue: Issue;
  readonly members: readonly Member[];
  readonly onCommit: (description: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(issue.description);
  const autosave = useAutosave({ value: draft, save: onCommit });
  const flush = autosave.saveNow;
  const settled = autosave.status === 'saved';
  const server = useRef(issue.description);

  useEffect(() => flush, [flush]);

  useEffect(() => {
    if (server.current === issue.description || !settled) return;
    server.current = issue.description;
    setDraft(issue.description);
  }, [issue.description, settled]);

  return (
    <RichTextEditor
      value={draft}
      onChange={setDraft}
      members={members}
      placeholder="Add a description, markdown works."
      ariaLabel="Issue description"
      testId="issue-description"
      onForceSave={flush}
      onBlur={flush}
    />
  );
}

export function IssueDetailView({ identifier, known }: IssueDetailViewProps) {
  const { toast } = useToast();
  const workspace = useWorkspace();
  const detail = useIssueDetail(identifier, known);
  const issue = detail.data?.issue;
  const comments = useComments(issue?.id ?? null);
  const update = useUpdateIssue(issue?.teamId ?? 'none');

  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (issue === undefined || detail.data === undefined) {
    return (
      <EmptyState
        icon={<Check strokeWidth={1.75} aria-hidden="true" />}
        title="Issue not found"
        description={`Nothing here matches ${identifier}.`}
      />
    );
  }

  const state = workspace.stateById.get(issue.stateId);
  const isSubscribed = subscribed ?? detail.data.subscribed;

  const toggleSubscribe = async () => {
    const previous = isSubscribed;
    const next = !previous;
    setSubscribed(next);
    try {
      const result = await apiFetch(`/api/issues/${issue.id}/subscribe`, subscribedSchema, {
        method: 'POST',
        body: { subscribed: next },
      });
      setSubscribed(result.subscribed);
    } catch (error: unknown) {
      setSubscribed(previous);
      toast({
        title: 'Could not change your subscription',
        description: messageOf(error),
        tone: 'danger',
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" data-testid="issue-detail">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <header className="flex items-center gap-2 border-border border-b px-5 py-2.5">
          <span data-numeric className="text-2xs text-faint">
            {issue.identifier}
          </span>
          {state === undefined ? null : (
            <span className="flex items-center gap-1.5 text-2xs text-muted">
              <StateGlyph category={state.category} color={state.color} />
              {state.name}
            </span>
          )}
          <PriorityGlyph priority={issue.priority} />
          <div className="ml-auto flex items-center gap-3">
            <ViewerPresence issueId={issue.id} />
            <Button
              size="sm"
              variant="ghost"
              data-testid="subscribe-toggle"
              onClick={() => {
                toggleSubscribe();
              }}
            >
              {isSubscribed ? (
                <Bell className="size-3.5" aria-hidden="true" />
              ) : (
                <BellOff className="size-3.5" aria-hidden="true" />
              )}
              {isSubscribed ? 'Subscribed' : 'Subscribe'}
            </Button>
          </div>
        </header>

        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
          <IssueTitle
            key={`${issue.id}:title`}
            issue={issue}
            onCommit={(title) => update.mutate({ issue, patch: { title } })}
          />

          <section className="flex flex-col gap-2">
            <IssueBody
              key={`${issue.id}:body`}
              issue={issue}
              members={workspace.members}
              onCommit={async (description) =>
                await update.mutateAsync({ issue, patch: { description } })
              }
            />
          </section>

          {detail.data.subIssues.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h2 className="text-2xs text-faint uppercase tracking-wide">Sub issues</h2>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {detail.data.subIssues.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/issue/${child.identifier}`}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-dense hover:bg-surface-2"
                    >
                      <span data-numeric className="text-2xs text-faint">
                        {child.identifier}
                      </span>
                      <span className="truncate text-text">{child.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.isPlaceholderData ? (
            <div className="flex flex-col gap-2" data-testid="issue-activity-pending">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              <IssuePullRequests issueId={issue.id} />

              <CommentThread
                issueId={issue.id}
                comments={comments.data ?? []}
                activity={detail.data.activity}
                members={workspace.members}
              />
            </>
          )}
        </div>
      </div>

      <IssueProperties issue={issue} />
    </div>
  );
}
