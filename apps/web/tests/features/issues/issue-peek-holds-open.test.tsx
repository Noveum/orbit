import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import type { Issue } from '@/lib/query/schemas.ts';

const realDetail = { ...(await import('@/features/issues/issue-detail.tsx')) };
const realLink = { ...(await import('@/features/issues/issue-link.tsx')) };

mock.module('@/features/issues/issue-detail.tsx', () => ({
  IssueDetailView: ({ identifier }: { identifier: string }) => (
    <div data-testid="peek-detail">{identifier}</div>
  ),
}));

mock.module('@/features/issues/issue-link.tsx', () => ({
  IssueLink: () => null,
}));

afterAll(() => {
  mock.module('@/features/issues/issue-detail.tsx', () => realDetail);
  mock.module('@/features/issues/issue-link.tsx', () => realLink);
});

const { IssuePeek } = await import('../../../src/features/issues/issue-peek.tsx');

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 3,
    identifier: 'ENG-3',
    title: 'Fan out delta packets',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    assigneeId: 'user_1',
    creatorId: 'user_1',
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    sortOrder: 1024,
    labelIds: [],
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    dueDate: null,
    stateEnteredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Issue;
}

afterEach(cleanup);

describe('the peek panel while you are reading it', () => {
  it('stays open when an edit drops the issue out of the list behind it', () => {
    const close = mock();
    const view = render(<IssuePeek issueId="issue_1" issue={issue()} onClose={close} />);
    expect(screen.getByTestId('issue-peek')).toBeInTheDocument();

    view.rerender(<IssuePeek issueId="issue_1" issue={undefined} onClose={close} />);

    expect(screen.getByTestId('issue-peek')).toBeInTheDocument();
    expect(screen.getByTestId('peek-detail')).toHaveTextContent('ENG-3');
    expect(close).not.toHaveBeenCalled();
  });

  it('closes when the reader closes it, rather than clinging to the last issue', () => {
    const close = mock();
    const view = render(<IssuePeek issueId="issue_1" issue={issue()} onClose={close} />);

    view.rerender(<IssuePeek issueId={null} issue={undefined} onClose={close} />);

    expect(screen.queryByTestId('issue-peek')).not.toBeInTheDocument();
  });

  it('shows the next issue rather than the one it was holding', () => {
    const close = mock();
    const view = render(<IssuePeek issueId="issue_1" issue={issue()} onClose={close} />);

    view.rerender(
      <IssuePeek
        issueId="issue_2"
        issue={issue({ id: 'issue_2', identifier: 'ENG-9' })}
        onClose={close}
      />,
    );

    expect(screen.getByTestId('peek-detail')).toHaveTextContent('ENG-9');
  });

  it('renders nothing for an issue it has never been given', () => {
    render(<IssuePeek issueId="issue_never" issue={undefined} onClose={mock()} />);

    expect(screen.queryByTestId('issue-peek')).not.toBeInTheDocument();
  });
});
