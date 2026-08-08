import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import type { Issue } from '@/lib/query/schemas.ts';

const toast = mock();

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const todo = {
  id: 'state_todo',
  teamId: 'team_1',
  name: 'In Progress',
  category: 'started',
  color: '#f2c94c',
  position: 1,
};

const marketing = { id: 'label_1', teamId: null, name: 'marketing', color: '#22a06b' };

let workspace: WorkspaceData;

function workspaceValue(ready = true): WorkspaceData {
  return {
    ready,
    userId: 'user_1',
    role: 'admin',
    teams: [{ id: 'team_1', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
    states: [todo],
    labels: [marketing],
    members: [],
    projects: [{ id: 'project_1', name: 'API.market', status: 'active', teamIds: ['team_1'] }],
    cycles: [],
    seedIssues: [],
    stateById: new Map([[todo.id, todo]]),
    labelById: new Map([[marketing.id, marketing]]),
    memberById: new Map([
      [
        'user_1',
        {
          id: 'user_1',
          name: 'Shashank',
          email: 'shashank@noveum.ai',
          image: null,
          handle: 'shashank',
          role: 'admin',
        },
      ],
    ]),
    openQuickCreate: () => undefined,
  } as unknown as WorkspaceData;
}

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { IssueCopyActions, absoluteIssueUrl } = await import(
  '../../../src/features/issues/issue-copy-actions.tsx'
);

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 42,
    identifier: 'ENG-42',
    title: 'Fan out delta packets',
    description: '',
    stateId: 'state_todo',
    priority: 1,
    creatorId: 'user_1',
    assigneeId: 'user_1',
    projectId: 'project_1',
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
    labelIds: ['label_1'],
    ...overrides,
  };
}

const writeText = mock((_value: string) => Promise.resolve());
const user = userEvent.setup({ pointerEventsCheck: 0 });

function renderActions(current: Issue = issue()): void {
  render(
    <TooltipProvider>
      <IssueCopyActions issue={current} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  toast.mockClear();
  writeText.mockClear();
  writeText.mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  workspace = workspaceValue();
});

describe('absoluteIssueUrl', () => {
  it('builds an absolute link anybody can paste', () => {
    expect(absoluteIssueUrl('ENG-42', 'https://orbit.noveum.ai')).toBe(
      'https://orbit.noveum.ai/issue/ENG-42',
    );
  });

  it('does not double the slash when the origin carries one', () => {
    expect(absoluteIssueUrl('ENG-42', 'https://orbit.noveum.ai/')).toBe(
      'https://orbit.noveum.ai/issue/ENG-42',
    );
  });
});

describe('IssueCopyActions', () => {
  it('copies a link to the issue', async () => {
    renderActions();

    await user.click(screen.getByTestId('issue-copy-link'));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/issue/ENG-42`);
  });

  it('copies the identifier on its own', async () => {
    renderActions();

    await user.click(screen.getByTestId('issue-copy-id'));

    expect(writeText).toHaveBeenCalledWith('ENG-42');
  });

  it('copies the branch name a developer would check out', async () => {
    renderActions();

    await user.click(screen.getByTestId('issue-copy-branch'));

    expect(writeText).toHaveBeenCalledWith('shashank/eng-42-fan-out-delta-packets');
  });

  it('copies a prompt carrying the branch and the issue context', async () => {
    renderActions();

    await user.click(screen.getByTestId('issue-copy-prompt'));

    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('Work on Orbit issue ENG-42:');
    expect(copied).toContain('Suggested branch name: shashank/eng-42-fan-out-delta-packets');
    expect(copied).toContain('<title>Fan out delta packets</title>');
    expect(copied).toContain('<team name="Engineering"/>');
    expect(copied).toContain('<state name="In Progress"/>');
    expect(copied).toContain('<label>marketing</label>');
    expect(copied).toContain('<project name="API.market"/>');
  });

  it('leaves priority out of the prompt when the issue has none', async () => {
    renderActions(issue({ priority: 0 }));

    await user.click(screen.getByTestId('issue-copy-prompt'));

    expect(writeText.mock.calls[0]?.[0] ?? '').not.toContain('<priority');
  });

  it('says so rather than failing silently when the browser refuses the clipboard', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    renderActions();

    await user.click(screen.getByTestId('issue-copy-id'));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
  });

  it('withholds the branch and prompt until the workspace has loaded, and still offers the link', () => {
    workspace = workspaceValue(false);
    renderActions();

    expect(screen.getByTestId('issue-copy-branch')).toBeDisabled();
    expect(screen.getByTestId('issue-copy-prompt')).toBeDisabled();
    expect(screen.getByTestId('issue-copy-link')).not.toBeDisabled();
  });
});
