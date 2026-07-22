'use client';

import { Bell, BellOff, Check, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { CommentThread } from '@/features/comments/comment-thread.tsx';
import { ViewerPresence } from '@/features/comments/viewer-presence.tsx';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { subscribedSchema } from '@/lib/query/schemas.ts';
import { useComments } from '@/lib/query/use-comments.ts';
import { useIssueDetail, useUpdateIssue } from '@/lib/query/use-issues.ts';
import { ActivityEntry } from './activity-feed.tsx';
import { IssueProperties } from './issue-properties.tsx';
import { PriorityGlyph } from './priority-glyph.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export interface IssueDetailViewProps {
  readonly identifier: string;
}

export function IssueDetailView({ identifier }: IssueDetailViewProps) {
  const workspace = useWorkspace();
  const detail = useIssueDetail(identifier);
  const issue = detail.data?.issue;
  const comments = useComments(issue?.id ?? null);
  const update = useUpdateIssue(issue?.teamId ?? 'none');

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
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
    const next = !isSubscribed;
    setSubscribed(next);
    await apiFetch(`/api/issues/${issue.id}/subscribe`, subscribedSchema, {
      method: 'POST',
      body: { subscribed: next },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" data-testid="issue-detail">
      <div className="min-h-0 flex-1 overflow-y-auto">
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
          {editingTitle ? (
            <Input
              autoFocus
              data-testid="title-input"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                update.mutate({ issue, patch: { title: titleDraft } });
                setEditingTitle(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  update.mutate({ issue, patch: { title: titleDraft } });
                  setEditingTitle(false);
                }
                if (event.key === 'Escape') setEditingTitle(false);
              }}
              className="h-10 border-0 px-0 font-medium text-xl shadow-none"
            />
          ) : (
            <button
              type="button"
              data-testid="issue-title"
              className="text-left font-medium text-text text-xl leading-tight"
              onClick={() => {
                setTitleDraft(issue.title);
                setEditingTitle(true);
              }}
            >
              {issue.title}
            </button>
          )}

          <section className="flex flex-col gap-2">
            {editingBody ? (
              <div className="flex flex-col gap-2">
                <Textarea
                  autoFocus
                  data-testid="description-input"
                  rows={8}
                  value={bodyDraft}
                  onChange={(event) => setBodyDraft(event.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditingBody(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      update.mutate({ issue, patch: { description: bodyDraft } });
                      setEditingBody(false);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid="issue-description"
                onClick={() => {
                  setBodyDraft(issue.description);
                  setEditingBody(true);
                }}
                className="group flex flex-col items-start gap-1 text-left"
              >
                {issue.description.length === 0 ? (
                  <span className="flex items-center gap-1.5 text-dense text-faint">
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Add a description
                  </span>
                ) : (
                  <div
                    className="prose-orbit w-full text-dense text-muted leading-relaxed [&_a]:text-accent [&_code]:rounded-sm [&_code]:bg-surface-2 [&_code]:px-1 [&_h2]:mt-4 [&_h2]:font-medium [&_h2]:text-text [&_li]:my-0.5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown is sanitized server side by @orbit/services/markdown
                    dangerouslySetInnerHTML={{ __html: detail.data.descriptionHtml }}
                  />
                )}
              </button>
            )}
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

          {detail.data.activity.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="text-2xs text-faint uppercase tracking-wide">Activity</h2>
              <ul className="flex flex-col gap-1.5" data-testid="activity-feed">
                {detail.data.activity.map((entry) => (
                  <ActivityEntry key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}

          <CommentThread
            issueId={issue.id}
            comments={comments.data ?? []}
            members={workspace.members}
          />
        </div>
      </div>

      <IssueProperties issue={issue} />
    </div>
  );
}
