import { describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function surface(): HTMLElement {
  const node = screen.getByTestId('comment-composer').querySelector('.ProseMirror');
  if (node === null) throw new Error('editor surface not found');
  return node as HTMLElement;
}

describe('CommentComposer', () => {
  it('mounts the shared rich editor so docs and comments format the same way', () => {
    render(<CommentComposer members={members} onSubmit={mock()} />);
    const editable = surface();
    expect(editable.getAttribute('role')).toBe('textbox');
    expect(editable.getAttribute('aria-multiline')).toBe('true');
  });

  it('shows an existing comment body when editing', () => {
    render(
      <CommentComposer
        members={members}
        submitLabel="Save"
        initialValue="already **written**"
        onSubmit={mock()}
      />,
    );
    expect(surface().textContent).toContain('already written');
  });

  it('submits with cmd enter and clears the draft', async () => {
    const user = userEvent.setup();
    const onSubmit = mock();
    render(<CommentComposer members={members} initialValue="ship it" onSubmit={onSubmit} />);

    await user.click(surface());
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSubmit).toHaveBeenCalledWith('ship it');
    await waitFor(() => expect(surface().textContent).toBe(''));
  });

  it('submits with the button and clears the draft', async () => {
    const user = userEvent.setup();
    const onSubmit = mock();
    render(<CommentComposer members={members} initialValue="ship it" onSubmit={onSubmit} />);

    await user.click(screen.getByTestId('comment-composer-submit'));

    expect(onSubmit).toHaveBeenCalledWith('ship it');
    await waitFor(() => expect(surface().textContent).toBe(''));
  });

  it('disables the submit button when the draft is empty', () => {
    render(<CommentComposer members={members} onSubmit={mock()} />);
    expect(screen.getByTestId('comment-composer-submit')).toBeDisabled();
  });

  it('enables the submit button when the draft has text', () => {
    render(<CommentComposer members={members} initialValue="hi" onSubmit={mock()} />);
    expect(screen.getByTestId('comment-composer-submit')).toBeEnabled();
  });

  it('escapes to cancel when the draft has no open menu', async () => {
    const user = userEvent.setup();
    const onCancel = mock();
    render(<CommentComposer members={members} onSubmit={mock()} onCancel={onCancel} />);

    await user.click(surface());
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
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
