'use client';

import { docCommentAnchorId, relativeTime } from '@orbit/shared/utils';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
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

export interface DocCommentsProps {
  readonly docId: string;
  readonly members: readonly Member[];
}

export function DocComments({ docId, members }: DocCommentsProps) {
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
            />
            <div className="ml-8 flex flex-col gap-3 border-border border-l pl-4 empty:hidden">
              {repliesOf(entry.comment.id).map((reply) => (
                <DocCommentItem
                  key={reply.comment.id}
                  docId={docId}
                  entry={reply}
                  author={memberById.get(reply.comment.authorId)}
                  members={members}
                  isReply
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      <CommentComposer
        members={members}
        testId="doc-comment-composer"
        pending={create.isPending}
        onSubmit={(body) => create.mutate({ body, parentId: null })}
      />
    </section>
  );
}

interface DocCommentItemProps {
  readonly docId: string;
  readonly entry: DocComment;
  readonly author: Member | undefined;
  readonly members: readonly Member[];
  readonly isReply?: boolean;
}

function DocCommentItem({ docId, entry, author, members, isReply = false }: DocCommentItemProps) {
  const currentUserId = useCurrentUserId();
  const update = useUpdateDocComment(docId);
  const remove = useDeleteDocComment(docId);
  const createReply = useCreateDocComment(docId);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const mine = entry.comment.authorId === currentUserId;

  return (
    <article
      id={docCommentAnchorId(entry.comment.id)}
      data-testid={`doc-comment-${entry.comment.id}`}
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
