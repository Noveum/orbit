'use client';

import { commentAnchorId, relativeTime } from '@orbit/shared/utils';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { SmilePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { useHashScroll } from '@/features/docs/use-hash-scroll.ts';
import { ActivityEntry } from '@/features/issues/activity-feed.tsx';
import { cn } from '@/lib/cn.ts';
import { revealOnHover } from '@/lib/interaction.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Activity, Comment, Member } from '@/lib/query/schemas.ts';
import { summarizeReactions } from '@/lib/query/sync.ts';
import {
  useCreateComment,
  useDeleteComment,
  useToggleReaction,
  useUpdateComment,
} from '@/lib/query/use-comments.ts';
import { useCurrentUserId } from '@/lib/realtime/session.tsx';
import { CommentComposer } from './comment-composer.tsx';
import { usePendingCommentFiles } from './comment-uploads.ts';

const QUICK_EMOJI = ['👍', '🎉', '🚀', '👀', '❤️'] as const;

export type TimelineEntry =
  | { readonly kind: 'activity'; readonly at: string; readonly activity: Activity }
  | { readonly kind: 'comment'; readonly at: string; readonly comment: Comment };

export function buildTimeline(
  activity: readonly Activity[],
  comments: readonly Comment[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...activity.map((item) => ({ kind: 'activity' as const, at: item.createdAt, activity: item })),
    ...comments
      .filter((entry) => entry.comment.parentId === null)
      .map((item) => ({ kind: 'comment' as const, at: item.comment.createdAt, comment: item })),
  ];
  return entries.sort((left, right) => left.at.localeCompare(right.at));
}

export interface CommentThreadProps {
  readonly issueId: string;
  readonly comments: readonly Comment[];
  readonly activity: readonly Activity[];
  readonly members: readonly Member[];
}

function cachedCommentBody(
  client: QueryClient,
  issueId: string,
  commentId: string,
): string | undefined {
  const cached = client.getQueryData<readonly Comment[]>(queryKeys.comments(issueId));
  return cached?.find((entry) => entry.comment.id === commentId)?.comment.body;
}

interface NewCommentProps {
  readonly issueId: string;
  readonly members: readonly Member[];
  readonly parentId: string | null;
  readonly testId?: string;
  readonly placeholder?: string;
  readonly submitLabel?: string;
  readonly autoFocus?: boolean;
  readonly onCancel?: () => void;
}

function NewComment({
  issueId,
  members,
  parentId,
  testId,
  placeholder,
  submitLabel,
  autoFocus = false,
  onCancel,
}: NewCommentProps) {
  const client = useQueryClient();
  const create = useCreateComment(issueId);
  const update = useUpdateComment(issueId);
  const files = usePendingCommentFiles();
  const { discard } = files;

  useEffect(() => () => discard(), [discard]);

  const submit = (body: string) => {
    const draft = files.draft(body);
    create.mutate(
      { body: draft.body, parentId },
      {
        onSuccess: (created) => {
          const asCreated = created.comment.body;
          draft
            .settle(created.comment.id)
            .then((rewritten) => {
              if (rewritten === null) return;
              const untouched =
                cachedCommentBody(client, issueId, created.comment.id) === asCreated;
              if (!untouched) return;
              update.mutate({ id: created.comment.id, body: rewritten });
            })
            .catch(() => undefined);
        },
        onError: () => draft.release(),
      },
    );
    onCancel?.();
  };

  return (
    <CommentComposer
      members={members}
      pending={create.isPending}
      autoFocus={autoFocus}
      onUpload={files.hold}
      onSubmit={submit}
      {...(testId === undefined ? {} : { testId })}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(submitLabel === undefined ? {} : { submitLabel })}
      {...(onCancel === undefined ? {} : { onCancel })}
    />
  );
}

export function CommentThread({ issueId, comments, activity, members }: CommentThreadProps) {
  const memberById = new Map(members.map((member) => [member.id, member]));
  useHashScroll(comments.map((entry) => entry.comment.id).join('|'));

  const timeline = buildTimeline(activity, comments);
  const repliesOf = (parentId: string) =>
    comments.filter((entry) => entry.comment.parentId === parentId);

  return (
    <section className="flex flex-col gap-4" data-testid="comment-thread">
      <ul className="flex flex-col gap-4">
        {timeline.map((item) =>
          item.kind === 'activity' ? (
            <ActivityEntry key={item.activity.id} entry={item.activity} />
          ) : (
            <li key={item.comment.comment.id} className="flex list-none flex-col gap-3">
              <CommentItem
                issueId={issueId}
                entry={item.comment}
                author={memberById.get(item.comment.comment.authorId)}
                members={members}
              />
              <div className="ml-8 flex flex-col gap-3 border-border border-l pl-4 empty:hidden">
                {repliesOf(item.comment.comment.id).map((reply) => (
                  <CommentItem
                    key={reply.comment.id}
                    issueId={issueId}
                    entry={reply}
                    author={memberById.get(reply.comment.authorId)}
                    members={members}
                    isReply
                  />
                ))}
              </div>
            </li>
          ),
        )}
      </ul>

      <NewComment issueId={issueId} members={members} parentId={null} />
    </section>
  );
}

const bodyClassName =
  'prose-orbit break-words text-dense text-text leading-relaxed [&_a]:text-accent [&_code]:rounded-sm [&_code]:bg-surface-2 [&_code]:px-1 [&_p]:my-1';

export function CommentBody({ body, bodyHtml }: { body: string; bodyHtml: string }) {
  if (bodyHtml.length === 0) {
    return <p className={cn(bodyClassName, 'whitespace-pre-wrap')}>{body}</p>;
  }
  return (
    <div
      className={bodyClassName}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown is sanitized server side by @orbit/services/markdown
      dangerouslySetInnerHTML={{ __html: bodyHtml }}
    />
  );
}

interface CommentItemProps {
  readonly issueId: string;
  readonly entry: Comment;
  readonly author: Member | undefined;
  readonly members: readonly Member[];
  readonly isReply?: boolean;
}

function CommentItem({ issueId, entry, author, members, isReply = false }: CommentItemProps) {
  const currentUserId = useCurrentUserId();
  const react = useToggleReaction(issueId);
  const update = useUpdateComment(issueId);
  const remove = useDeleteComment(issueId);
  const files = usePendingCommentFiles();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const mine = entry.comment.authorId === currentUserId;
  const summary = summarizeReactions(entry.reactions, currentUserId);

  return (
    <article
      id={commentAnchorId(entry.comment.id)}
      data-testid={`comment-${entry.comment.id}`}
      className="group flex scroll-mt-24 gap-2.5"
    >
      <Avatar name={author?.name ?? 'Unknown'} src={author?.image ?? null} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2 text-2xs">
          <span className="font-medium text-text">{author?.name ?? 'Unknown'}</span>
          <span className="text-faint">
            {relativeTime(new Date(entry.comment.createdAt), new Date())}
          </span>
          {entry.comment.editedAt === null ? null : <span className="text-faint">edited</span>}
        </div>

        {editing ? (
          <CommentComposer
            members={members}
            testId={`comment-edit-${entry.comment.id}`}
            initialValue={entry.comment.body}
            submitLabel="Save"
            autoFocus
            onCancel={() => setEditing(false)}
            onUpload={async (file) => await files.upload(entry.comment.id, file)}
            onSubmit={(body) => {
              update.mutate({ id: entry.comment.id, body });
              setEditing(false);
            }}
          />
        ) : (
          <CommentBody body={entry.comment.body} bodyHtml={entry.bodyHtml} />
        )}

        <div className="flex flex-wrap items-center gap-1">
          {summary.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              data-testid={`reaction-${reaction.emoji}`}
              onClick={() => react.mutate({ commentId: entry.comment.id, emoji: reaction.emoji })}
              className={cn(
                'flex h-6 items-center gap-1 rounded-full border px-2 text-2xs',
                'animate-pop-in transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:border-border-strong',
                reaction.mine
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface text-muted',
              )}
            >
              <span aria-hidden="true">{reaction.emoji}</span>
              <span data-numeric>{reaction.count}</span>
            </button>
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Add reaction"
                data-testid={`add-reaction-${entry.comment.id}`}
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border border-border border-dashed text-faint hover:border-border-strong hover:text-text',
                  revealOnHover,
                )}
              >
                <SmilePlus className="size-3" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-0">
              <div className="flex gap-0.5">
                {QUICK_EMOJI.map((emoji) => (
                  <DropdownMenuItem
                    key={emoji}
                    data-testid={`pick-reaction-${emoji}`}
                    className="justify-center px-2 text-base"
                    onSelect={() => react.mutate({ commentId: entry.comment.id, emoji })}
                  >
                    {emoji}
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className={cn('flex items-center gap-1', revealOnHover)}>
            {isReply ? null : (
              <Button size="sm" variant="ghost" onClick={() => setReplying((open) => !open)}>
                Reply
              </Button>
            )}
            {mine ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(entry.comment.id)}>
                  Delete
                </Button>
              </>
            ) : null}
          </span>
        </div>

        {replying ? (
          <NewComment
            issueId={issueId}
            members={members}
            parentId={entry.comment.id}
            testId={`comment-reply-${entry.comment.id}`}
            placeholder="Write a reply."
            submitLabel="Reply"
            autoFocus
            onCancel={() => setReplying(false)}
          />
        ) : null}
      </div>
    </article>
  );
}
