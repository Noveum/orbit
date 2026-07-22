import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Activity, Comment, Member } from '@/lib/query/schemas.ts';
import { applyMention, CommentComposer, findMentionQuery } from './comment-composer.tsx';
import { buildTimeline, CommentBody } from './comment-thread.tsx';

const members: readonly Member[] = [
  {
    id: 'user_1',
    name: 'Shashank Agarwal',
    email: 'shashank@noveum.ai',
    image: null,
    handle: 'shashank',
    role: 'member',
  },
  {
    id: 'user_2',
    name: 'Aditi Rao',
    email: 'aditi@noveum.ai',
    image: null,
    handle: 'aditi',
    role: 'member',
  },
];

describe('mention parsing', () => {
  it('finds a mention that starts a word', () => {
    expect(findMentionQuery('hey @sha', 8)).toEqual({ query: 'sha', start: 4 });
    expect(findMentionQuery('@sha', 4)).toEqual({ query: 'sha', start: 0 });
  });

  it('ignores an email like at sign and a finished mention', () => {
    expect(findMentionQuery('mail me at me@example.com', 25)).toBeNull();
    expect(findMentionQuery('@shashank thanks', 16)).toBeNull();
  });

  it('replaces the typed fragment with the handle', () => {
    expect(applyMention('hey @sha', { query: 'sha', start: 4 }, 'shashank')).toBe('hey @shashank ');
  });
});

describe('CommentComposer', () => {
  it('submits with cmd enter and clears the draft', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CommentComposer members={members} onSubmit={onSubmit} />);

    const box = screen.getByTestId('comment-composer');
    await user.click(box);
    await user.keyboard('Ship it');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSubmit).toHaveBeenCalledWith('Ship it');
    expect(box).toHaveValue('');
  });

  it('keeps the submit button disabled until there is text', async () => {
    const user = userEvent.setup();
    render(<CommentComposer members={members} onSubmit={vi.fn()} />);

    const button = screen.getByTestId('comment-composer-submit');
    expect(button).toBeDisabled();
    await user.click(screen.getByTestId('comment-composer'));
    await user.keyboard('Hi');
    expect(button).toBeEnabled();
  });

  it('offers matching members after an at sign and inserts the handle', async () => {
    const user = userEvent.setup();
    render(<CommentComposer members={members} onSubmit={vi.fn()} />);

    await user.click(screen.getByTestId('comment-composer'));
    await user.keyboard('ping @adi');

    const list = await screen.findByTestId('mention-list');
    expect(list).toBeInTheDocument();
    await user.click(screen.getByText('Aditi Rao'));
    expect(screen.getByTestId('comment-composer')).toHaveValue('ping @aditi ');
  });
});

describe('CommentBody', () => {
  it('renders the sanitized html the server produced', () => {
    render(<CommentBody body="**bold**" bodyHtml="<p><strong>bold</strong></p>" />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('falls back to plain text when a delta arrives without rendered markdown', () => {
    render(<CommentBody body="raw <script>alert(1)</script> text" bodyHtml="" />);
    expect(screen.getByText(/raw <script>alert\(1\)<\/script> text/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
});

function comment(id: string, at: string, parentId: string | null = null): Comment {
  return {
    comment: {
      id,
      issueId: 'issue_1',
      authorId: 'user_1',
      parentId,
      body: id,
      editedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      syncId: 1,
    },
    bodyHtml: `<p>${id}</p>`,
    reactions: [],
  };
}

function activity(id: string, at: string): Activity {
  return {
    id,
    issueId: 'issue_1',
    actorId: 'user_1',
    actorName: 'Shashank Agarwal',
    field: 'stateId',
    summary: 'moved from Todo to Done',
    createdAt: at,
  };
}

describe('buildTimeline', () => {
  it('interleaves activity and root comments in time order', () => {
    const timeline = buildTimeline(
      [activity('a1', '2026-01-01T10:00:00.000Z'), activity('a2', '2026-01-01T12:00:00.000Z')],
      [
        comment('c1', '2026-01-01T11:00:00.000Z'),
        comment('reply', '2026-01-01T11:30:00.000Z', 'c1'),
      ],
    );

    expect(timeline.map((entry) => entry.kind)).toEqual(['activity', 'comment', 'activity']);
    expect(timeline.map((entry) => entry.at)).toEqual([
      '2026-01-01T10:00:00.000Z',
      '2026-01-01T11:00:00.000Z',
      '2026-01-01T12:00:00.000Z',
    ]);
  });
});
