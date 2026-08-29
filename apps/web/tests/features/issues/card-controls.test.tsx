import { describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { Issue, Member } from '@/lib/query/schemas.ts';

const member: Member = {
  id: 'user_2',
  name: 'Aditi Rao',
  email: 'aditi@orbit.test',
  image: '/aditi.png',
  handle: 'aditi',
  role: 'member',
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  useWorkspace: () => ({ members: [member] }),
}));

mock.module('@/lib/query/use-issues.ts', () => ({
  useUpdateIssue: () => ({ mutate: mock() }),
}));

const { AssigneeControl } = await import('@/features/issues/card-controls.tsx');

const issue = {
  id: 'issue_1',
  organizationId: 'org_1',
  teamId: 'team_1',
  number: 1,
  identifier: 'ENG-1',
  title: 'Show avatars',
  description: '',
  stateId: 'state_1',
  priority: 0,
  creatorId: 'user_1',
  assigneeId: null,
  reviewerIds: [],
  projectId: null,
  milestoneId: null,
  cycleId: null,
  parentId: null,
  estimate: null,
  dueDate: null,
  sortOrder: 1024,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  stateEnteredAt: '2026-01-01T00:00:00.000Z',
  syncId: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  labelIds: [],
} satisfies Issue;

describe('AssigneeControl', () => {
  it('shows member profile pictures in the Kanban assignee picker', async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AssigneeControl issue={issue} assignee={undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByTestId('card-assignee-ENG-1'));
    const menu = await screen.findByTestId('card-assignee-menu');

    expect(
      within(menu).getByText(member.name).parentElement?.querySelector('[role="img"]'),
    ).not.toBeNull();
    expect(within(menu).getByRole('menuitemradio', { name: member.name })).toBeInTheDocument();
  });
});
