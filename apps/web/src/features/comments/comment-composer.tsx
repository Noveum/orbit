'use client';

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { RichTextEditor } from '@/features/docs/editor/rich-text-editor.tsx';
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
  placeholder = 'Leave a comment. Markdown, / for blocks, and @mentions work.',
  submitLabel = 'Comment',
  pending = false,
  autoFocus = false,
  initialValue = '',
  onSubmit,
  onCancel,
  testId = 'comment-composer',
}: CommentComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [resetKey, setResetKey] = useState(0);
  const latest = useRef(initialValue);

  const submit = useCallback(() => {
    const body = latest.current.trim();
    if (body.length === 0) return;
    onSubmit(body);
    latest.current = '';
    setValue('');
    setResetKey((key) => key + 1);
  }, [onSubmit]);

  const change = useCallback((next: string) => {
    latest.current = next;
    setValue(next);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-border-strong">
        <RichTextEditor
          key={resetKey}
          value={value}
          onChange={change}
          members={members}
          placeholder={placeholder}
          ariaLabel={submitLabel === 'Comment' ? 'Comment body' : submitLabel}
          testId={testId}
          autoFocus={autoFocus}
          onSubmit={submit}
          {...(onCancel === undefined ? {} : { onCancel })}
        />
      </div>

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
