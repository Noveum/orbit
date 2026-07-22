'use client';

import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { cn } from '@/lib/cn.ts';
import type { Member } from '@/lib/query/schemas.ts';

export interface MentionQuery {
  readonly query: string;
  readonly start: number;
}

export function findMentionQuery(value: string, caret: number): MentionQuery | null {
  const upToCaret = value.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');
  if (at === -1) return null;
  const before = at === 0 ? ' ' : upToCaret.charAt(at - 1);
  if (!/\s/.test(before)) return null;
  const query = upToCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

export function applyMention(value: string, mention: MentionQuery, handle: string): string {
  const end = mention.start + mention.query.length + 1;
  return `${value.slice(0, mention.start)}@${handle} ${value.slice(end)}`;
}

export interface CommentComposerProps {
  readonly members: readonly Member[];
  readonly placeholder?: string;
  readonly submitLabel?: string;
  readonly pending?: boolean;
  readonly autoFocus?: boolean;
  readonly initialValue?: string;
  readonly onSubmit: (body: string) => void;
  readonly onCancel?: () => void;
  readonly testId?: string;
}

export function CommentComposer({
  members,
  placeholder = 'Leave a comment. Markdown and @mentions work.',
  submitLabel = 'Comment',
  pending = false,
  autoFocus = false,
  initialValue = '',
  onSubmit,
  onCancel,
  testId = 'comment-composer',
}: CommentComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const matches = useMemo(() => {
    if (mention === null) return [];
    const query = mention.query.toLowerCase();
    return members
      .filter(
        (member) =>
          member.name.toLowerCase().includes(query) ||
          (member.handle ?? '').toLowerCase().includes(query),
      )
      .slice(0, 5);
  }, [mention, members]);

  const submit = () => {
    const body = value.trim();
    if (body.length === 0) return;
    onSubmit(body);
    setValue('');
    setMention(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape' && onCancel !== undefined) onCancel();
  };

  const pickMention = (member: Member) => {
    if (mention === null) return;
    setValue(applyMention(value, mention, member.handle ?? member.name));
    setMention(null);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative flex flex-col gap-2">
      <Textarea
        ref={textareaRef}
        data-testid={testId}
        rows={3}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setValue(event.target.value);
          setMention(findMentionQuery(event.target.value, event.target.selectionStart));
        }}
      />

      {matches.length > 0 ? (
        <ul
          data-testid="mention-list"
          className="absolute bottom-14 left-2 z-20 w-56 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-pop"
        >
          {matches.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => pickMention(member)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-dense text-muted',
                  'transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text',
                )}
              >
                <span className="truncate">{member.name}</span>
                <span className="ml-auto truncate text-2xs text-faint">
                  @{member.handle ?? member.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-2xs text-faint">
          <Kbd keys={['mod', 'enter']} /> to send
        </span>
        {onCancel === undefined ? null : (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          data-testid={`${testId}-submit`}
          className={onCancel === undefined ? 'ml-auto' : undefined}
          disabled={pending || value.trim().length === 0}
          onClick={submit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
