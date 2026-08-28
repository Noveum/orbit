import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  ExternalLink,
  GitCommit,
  GitPullRequest,
  MessageSquareText,
  UserRoundCheck,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { CommentBody } from '@/features/comments/comment-thread.tsx';
import { DocBody } from '@/features/docs/doc-body.tsx';
import { IssueLink } from '@/features/issues/issue-link.tsx';
import { cn } from '@/lib/cn.ts';
import type { PullRequestActivityRow, PullRequestDetail } from './data.ts';
import { prStateLabel, prStateTone } from './pr-state.ts';

function activityLabel(activity: PullRequestActivityRow): string {
  if (activity.type === 'review') return `submitted a ${activity.state.replaceAll('_', ' ')}`;
  if (activity.type === 'review_request') return 'requested a review';
  if (activity.type === 'review_comment') return 'commented on the diff';
  if (activity.type === 'comment') return 'commented';
  if (activity.type === 'checks') return `reported checks ${activity.state}`;
  return activity.action.replaceAll('_', ' ');
}

function activityIconLabel(activity: PullRequestActivityRow): string {
  if (activity.type === 'review') return `Review ${activity.state.replaceAll('_', ' ')}`;
  if (activity.type === 'review_request') return 'Review requested';
  if (activity.type === 'review_comment') return 'Review comment';
  if (activity.type === 'comment') return 'Pull request comment';
  if (activity.type === 'checks') return `Checks ${activity.state}`;
  if (activity.type === 'pull_request') return 'Pull request update';
  return 'Commit update';
}

function activityIconTone(activity: PullRequestActivityRow): string {
  if (activity.type === 'checks' && activity.state === 'failure') {
    return 'bg-danger-soft text-danger';
  }
  if (activity.type === 'checks' && activity.state === 'success') {
    return 'bg-surface-2 text-success';
  }
  if (activity.type === 'review' && activity.state === 'approved') {
    return 'bg-surface-2 text-success';
  }
  if (activity.type === 'review' && activity.state === 'changes_requested') {
    return 'bg-surface-2 text-warning';
  }
  if (activity.type === 'comment' || activity.type === 'review_comment') {
    return 'bg-accent-soft text-accent';
  }
  return 'bg-surface-2 text-muted';
}

function ActivityIcon({ activity }: { readonly activity: PullRequestActivityRow }) {
  if (activity.type === 'comment' || activity.type === 'review_comment') {
    return <MessageSquareText className="size-4" aria-hidden="true" />;
  }
  if (activity.type === 'review' || activity.type === 'review_request') {
    return <UserRoundCheck className="size-4" aria-hidden="true" />;
  }
  if (activity.type === 'checks' && activity.state === 'failure') {
    return <CircleX className="size-4" aria-hidden="true" />;
  }
  if (activity.type === 'checks') return <CircleCheck className="size-4" aria-hidden="true" />;
  if (activity.type === 'pull_request') {
    return <GitPullRequest className="size-4" aria-hidden="true" />;
  }
  return <GitCommit className="size-4" aria-hidden="true" />;
}

export function PullDetail({ pull }: { readonly pull: PullRequestDetail }) {
  return (
    <div
      data-testid="pull-detail"
      className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 bg-surface p-5 sm:p-8"
    >
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/pulls"
            className="inline-flex items-center gap-1.5 rounded-sm text-muted text-sm hover:text-text"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Pull requests
          </Link>
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-dense text-text shadow-sm hover:bg-surface-2"
          >
            Open on GitHub
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-faint text-xs">
            {pull.repository}#{pull.number ?? '?'}
          </span>
          <h1 className="font-semibold text-2xl text-text tracking-tight">{pull.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-muted text-sm">
            <Badge tone={prStateTone(pull.state)}>{prStateLabel(pull.state)}</Badge>
            {pull.checkStatus === 'success' ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CircleCheck className="size-4" aria-hidden="true" />
                Checks passing
              </span>
            ) : null}
            {pull.checkStatus === 'failure' ? (
              <span className="inline-flex items-center gap-1 text-danger">
                <CircleX className="size-4" aria-hidden="true" />
                Checks failing
              </span>
            ) : null}
            {pull.authorLogin.length > 0 ? <span>by {pull.authorLogin}</span> : null}
            {pull.branch === null ? null : (
              <span className="font-mono text-xs">
                {pull.branch} → {pull.baseRef}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <main className="flex min-w-0 flex-col gap-6">
          {pull.body.length === 0 ? null : (
            <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
              <h2 className="mb-3 font-medium text-dense text-text">Description</h2>
              <DocBody html={pull.bodyHtml} className="text-sm leading-6" />
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-text">Activity</h2>
              <span className="text-faint text-xs">
                {pull.activityCount > pull.activities.length
                  ? `Showing latest ${pull.activities.length} of ${pull.activityCount} events`
                  : `${pull.activityCount} ${pull.activityCount === 1 ? 'event' : 'events'}`}
              </span>
            </div>
            {pull.activities.length === 0 ? (
              <div className="rounded-lg border border-border p-5 text-muted text-sm">
                Activity will appear here as GitHub sends reviews, comments, checks, and PR updates.
              </div>
            ) : (
              <ol className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
                {pull.activities.map((activity) => (
                  <li
                    key={activity.id}
                    className="flex gap-3 border-border border-b p-4 last:border-b-0"
                  >
                    <span
                      role="img"
                      aria-label={activityIconLabel(activity)}
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                        activityIconTone(activity),
                      )}
                    >
                      <ActivityIcon activity={activity} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 text-dense">
                        <span className="font-medium text-text">{activity.actorLogin}</span>
                        <span className="text-muted">{activityLabel(activity)}</span>
                        <span className="text-faint text-xs">
                          <RelativeTime at={activity.occurredAt} />
                        </span>
                      </div>
                      {activity.path === null ? null : (
                        <span className="font-mono text-faint text-xs">
                          {activity.path}
                          {activity.line === null ? '' : `:${activity.line}`}
                        </span>
                      )}
                      {activity.body.length === 0 ? null : (
                        <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-sm">
                          <CommentBody body={activity.body} bodyHtml={activity.bodyHtml} />
                        </div>
                      )}
                      {activity.url.length === 0 ? null : (
                        <a
                          href={activity.url}
                          target="_blank"
                          rel="noreferrer"
                          className="w-fit rounded-sm text-accent text-xs hover:underline"
                        >
                          View on GitHub
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </main>

        <aside className="flex h-fit flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h2 className="font-medium text-dense text-text">Linked Orbit work</h2>
          {pull.linkedIssues.length === 0 ? (
            <p className="text-muted text-sm">No Orbit task is linked to this pull request.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pull.linkedIssues.map((linked) => (
                <li key={linked.identifier} className="flex flex-col gap-1">
                  <IssueLink
                    identifier={linked.identifier}
                    testId={`pull-detail-issue-${linked.identifier}`}
                    className="rounded-sm text-dense text-text hover:text-accent"
                  >
                    {linked.identifier} {linked.title}
                  </IssueLink>
                  {linked.project === null ? null : (
                    <Link
                      href={`/projects/${linked.project.slug}`}
                      className="w-fit rounded-sm text-accent text-xs hover:underline"
                    >
                      {linked.project.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
