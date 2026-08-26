'use client';

import { docCommentAnchorId, isDocAnchorOrphaned } from '@orbit/shared/utils';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import { Quote, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { CommentComposer } from '@/features/comments/comment-composer.tsx';
import { CommentBody } from '@/features/comments/comment-thread.tsx';
import { cn } from '@/lib/cn.ts';
import { revealOnHover } from '@/lib/interaction.ts';
import type { DocComment, Member } from '@/lib/query/schemas.ts';
import {
  useCreateDocComment,
  useDeleteDocComment,
  useDocComments,
  useUpdateDocComment,
} from '@/lib/query/use-doc-comments.ts';
import { useCurrentUserId } from '@/lib/realtime/session.tsx';
import { useHashScroll } from './use-hash-scroll.ts';

function sortByCreatedAt(comments: readonly DocComment[]): DocComment[] {
  return [...comments].sort((left, right) =>
    left.comment.createdAt.localeCompare(right.comment.createdAt),
  );
}

export function anchorState(
  anchor: DocCommentAnchor | null,
  text: string | null,
): 'none' | 'found' | 'orphaned' {
  if (anchor === null) return 'none';
  if (text === null) return 'found';
  return isDocAnchorOrphaned(text, anchor) ? 'orphaned' : 'found';
}

export interface DocCommentsProps {
  readonly docId: string;
  readonly members: readonly Member[];
  readonly anchorText?: string | null;
  readonly pendingAnchor?: DocCommentAnchor | null;
  readonly onPendingAnchorChange?: (anchor: DocCommentAnchor | null) => void;
  readonly focusedCommentId?: string | null;
  readonly onRevealPassage?: (commentId: string) => void;
}

export function DocComments({
  docId,
  members,
  anchorText = null,
  pendingAnchor = null,
  onPendingAnchorChange,
  focusedCommentId = null,
  onRevealPassage,
}: DocCommentsProps) {
  const query = useDocComments(docId);
  const create = useCreateDocComment(docId);
  const comments = useMemo(() => query.data ?? [], [query.data]);
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  useHashScroll(comments.map((entry) => entry.comment.id).join('|'));

  const roots = sortByCreatedAt(comments.filter((entry) => entry.comment.parentId === null));
  const repliesOf = (parentId: string) =>
    sortByCreatedAt(comments.filter((entry) => entry.comment.parentId === parentId));

  return (
    <section
      data-testid="doc-comments"
      className="mx-auto flex w-full max-w-[45rem] flex-col gap-4 border-border border-t px-6 py-8"
    >
      <h2 className="font-medium text-2xs text-faint uppercase tracking-wide">
        {roots.length === 0 ? 'Comments' : `Comments · ${comments.length}`}
      </h2>

      <ul className="flex flex-col gap-4">
        {roots.map((entry) => (
          <li key={entry.comment.id} className="flex list-none flex-col gap-3">
            <DocCommentItem
              docId={docId}
              entry={entry}
              author={memberById.get(entry.comment.authorId)}
              members={members}
              anchorText={anchorText}
              focused={focusedCommentId === entry.comment.id}
              {...(onRevealPassage === undefined ? {} : { onRevealPassage })}
            />
            <div className="ml-8 flex flex-col gap-3 border-border border-l pl-4 empty:hidden">
              {repliesOf(entry.comment.id).map((reply) => (
                <DocCommentItem
                  key={reply.comment.id}
                  docId={docId}
                  entry={reply}
                  author={memberById.get(reply.comment.authorId)}
                  members={members}
                  anchorText={anchorText}
                  focused={focusedCommentId === reply.comment.id}
                  isReply
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {pendingAnchor === null ? null : (
        <div
          data-testid="doc-comment-pending-anchor"
          className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2"
        >
          <Quote className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-2xs text-muted italic">{pendingAnchor.quote}</p>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Comment on the whole document instead"
            data-testid="doc-comment-pending-anchor-clear"
            className="size-6 shrink-0 px-0"
            onClick={() => onPendingAnchorChange?.(null)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      <CommentComposer
        members={members}
        testId="doc-comment-composer"
        pending={create.isPending}
        {...(pendingAnchor === null ? {} : { placeholder: 'Comment on the selected passage.' })}
        onSubmit={(body) => {
          create.mutate({ body, parentId: null, anchor: pendingAnchor });
          onPendingAnchorChange?.(null);
        }}
      />
    </section>
  );
}

interface DocCommentItemProps {
  readonly docId: string;
  readonly entry: DocComment;
  readonly author: Member | undefined;
  readonly members: readonly Member[];
  readonly anchorText: string | null;
  readonly focused: boolean;
  readonly onRevealPassage?: (commentId: string) => void;
  readonly isReply?: boolean;
}

function DocCommentItem({
  docId,
  entry,
  author,
  members,
  anchorText,
  focused,
  onRevealPassage,
  isReply = false,
}: DocCommentItemProps) {
  const currentUserId = useCurrentUserId();
  const update = useUpdateDocComment(docId);
  const remove = useDeleteDocComment(docId);
  const createReply = useCreateDocComment(docId);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const article = useRef<HTMLElement>(null);

  const mine = entry.comment.authorId === currentUserId;
  const anchor = entry.comment.anchor;
  const state = anchorState(anchor, anchorText);

  useEffect(() => {
    if (!focused) return;
    article.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  return (
    <article
      ref={article}
      id={docCommentAnchorId(entry.comment.id)}
      data-testid={`doc-comment-${entry.comment.id}`}
      data-focused={focused ? 'true' : 'false'}
      className={cn(
        'group flex scroll-mt-24 gap-2.5 rounded-lg transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
        focused && 'bg-accent-soft/60',
      )}
    >
      <Avatar name={author?.name ?? 'Unknown'} src={author?.image ?? null} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2 text-2xs">
          <span className="font-medium text-text">{author?.name ?? 'Unknown'}</span>
          <span className="text-faint">
            <RelativeTime at={entry.comment.createdAt} />
          </span>
          {entry.comment.editedAt === null ? null : <span className="text-faint">edited</span>}
        </div>

        {anchor === null ? null : (
          <DocCommentQuote
            commentId={entry.comment.id}
            anchor={anchor}
            orphaned={state === 'orphaned'}
            {...(onRevealPassage === undefined ? {} : { onReveal: onRevealPassage })}
          />
        )}

        {editing ? (
          <CommentComposer
            members={members}
            testId={`doc-comment-edit-${entry.comment.id}`}
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
          <CommentBody body={entry.comment.body} bodyHtml={entry.bodyHtml} />
        )}

        <div className={cn('flex items-center gap-1', revealOnHover)}>
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
            testId={`doc-comment-reply-${entry.comment.id}`}
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

function quoteLabel(orphaned: boolean, revealable: boolean): string {
  if (orphaned) return 'The quoted passage is gone';
  if (!revealable) return 'The quoted passage';
  return 'Go to the quoted passage';
}

function DocCommentQuote({
  commentId,
  anchor,
  orphaned,
  onReveal,
}: {
  readonly commentId: string;
  readonly anchor: DocCommentAnchor;
  readonly orphaned: boolean;
  readonly onReveal?: (commentId: string) => void;
}) {
  const reachable = onReveal !== undefined && !orphaned;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-testid={`doc-comment-quote-${commentId}`}
        disabled={!reachable}
        aria-label={quoteLabel(orphaned, onReveal !== undefined)}
        onClick={() => onReveal?.(commentId)}
        className={cn(
          'flex w-full items-start gap-2 rounded-md border-l-2 py-1 pr-2 pl-2 text-left text-2xs italic',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
          orphaned
            ? 'border-l-border-strong bg-surface-2 text-faint'
            : 'border-l-accent bg-accent-soft/50 text-muted',
          reachable && 'hover:bg-accent-soft',
        )}
      >
        <span className="line-clamp-3 min-w-0 flex-1">{anchor.quote}</span>
      </button>
      {orphaned ? (
        <span data-testid={`doc-comment-orphan-${commentId}`} className="text-2xs text-faint">
          This text was edited out of the document.
        </span>
      ) : null}
    </div>
  );
}
