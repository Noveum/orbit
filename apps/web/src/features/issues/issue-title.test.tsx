import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Issue } from '@/lib/query/schemas.ts';
import { IssueTitle } from './issue-detail.tsx';

function issue(): Issue {
  return { id: 'issue_1', title: 'Ship the sync engine' } as unknown as Issue;
}

afterEach(cleanup);

describe('renaming an issue in place', () => {
  it('commits the new title when the field loses focus', async () => {
    const user = userEvent.setup();
    const onCommit = mock((_title: string) => undefined);
    render(<IssueTitle issue={issue()} onCommit={onCommit} />);

    const field = screen.getByTestId('issue-title');
    await user.clear(field);
    await user.type(field, 'Ship the sync engine v2');
    await user.tab();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBe('Ship the sync engine v2');
  });

  it('throws the edit away on Escape rather than saving what was abandoned', async () => {
    const user = userEvent.setup();
    const onCommit = mock((_title: string) => undefined);
    render(<IssueTitle issue={issue()} onCommit={onCommit} />);

    const field = screen.getByTestId('issue-title');
    await user.clear(field);
    await user.type(field, 'A title nobody asked for');
    await user.keyboard('{Escape}');

    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue('Ship the sync engine');
  });

  it('refuses to save an empty title and puts the old one back', async () => {
    const user = userEvent.setup();
    const onCommit = mock((_title: string) => undefined);
    render(<IssueTitle issue={issue()} onCommit={onCommit} />);

    const field = screen.getByTestId('issue-title');
    await user.clear(field);
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue('Ship the sync engine');
  });

  it('says nothing to the server when the title is unchanged', async () => {
    const user = userEvent.setup();
    const onCommit = mock((_title: string) => undefined);
    render(<IssueTitle issue={issue()} onCommit={onCommit} />);

    await user.click(screen.getByTestId('issue-title'));
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
  });
});
