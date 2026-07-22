'use client';

import { relativeTime } from '@orbit/shared/utils';
import { SmilePlus } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { ActivityEntry } from '@/features/issues/activity-feed.tsx';
import { cn } from '@/lib/cn.ts';
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

export function CommentThread({ issueId, comments, activity, members }: CommentThreadProps) {
  const create = useCreateComment(issueId);
  const memberById = new Map(members.map((member) => [member.id, member]));

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

      <CommentComposer
        members={members}
        pending={create.isPending}
        onSubmit={(body) => create.mutate({ body, parentId: null })}
      />
    </section>
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
  const createReply = useCreateComment(issueId);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const mine = entry.comment.authorId === currentUserId;
  const summary = summarizeReactions(entry.reactions, currentUserId);

  return (
    <article data-testid={`comment-${entry.comment.id}`} className="flex gap-2.5">
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
            onSubmit={(body) => {
              update.mutate({ id: entry.comment.id, body });
              setEditing(false);
            }}
          />
        ) : (
          <div
            className="prose-orbit text-dense text-text leading-relaxed [&_a]:text-accent [&_code]:rounded-sm [&_code]:bg-surface-2 [&_code]:px-1 [&_p]:my-1"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown is sanitized server side by @orbit/services/markdown
            dangerouslySetInnerHTML={{ __html: entry.bodyHtml }}
          />
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
                'animate-pop-in transition-[transform,background-color,border-color] duration-[var(--duration-fast)] hover:scale-105',
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
                className="flex size-6 items-center justify-center rounded-full border border-border border-dashed text-faint transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:text-text"
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
        </div>

        {replying ? (
          <CommentComposer
            members={members}
            testId={`comment-reply-${entry.comment.id}`}
            placeholder="Write a reply."
            submitLabel="Reply"
            autoFocus
            onCancel={() => setReplying(false)}
            onSubmit={(body) => {
              createReply.mutate({ body, parentId: entry.comment.id });
              setReplying(false);
            }}
          />
        ) : null}
      </div>
    </article>
  );
}
