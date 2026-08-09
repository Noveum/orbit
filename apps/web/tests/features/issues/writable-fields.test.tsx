import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { render } from '@/test/render.tsx';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile([
  '@/features/issues/workspace-provider.tsx',
  '@/lib/query/use-issue-search.ts',
  '@/lib/query/use-issues.ts',
]);

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/issue/ENG-1',
  useParams: () => ({}),
}));

const patched: Record<string, unknown>[] = [];
const created: Record<string, unknown>[] = [];

const issuesQuery = await import('@/lib/query/use-issues.ts');
const workspaceProvider = await import('@/features/issues/workspace-provider.tsx');

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Domain auto join',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_1',
    assigneeId: null,
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
    ...overrides,
  };
}

const state = {
  id: 'state_todo',
  teamId: 'team_1',
  name: 'Todo',
  category: 'unstarted',
  color: '#888888',
  position: 1,
};

function workspaceFixture(): WorkspaceData {
  return {
    ...({} as WorkspaceData),
    ready: true,
    userId: 'user_1',
    teams: [{ id: 'team_1', name: 'Engineering', key: 'ENG', icon: 'e', color: '#ffffff' }],
    states: [state],
    labels: [],
    members: [],
    projects: [],
    cycles: [],
    seedIssues: [],
    stateById: new Map([[state.id, state]]),
    labelById: new Map(),
    memberById: new Map(),
    openQuickCreate: () => undefined,
  };
}

beforeEach(() => {
  patched.length = 0;
  created.length = 0;
  mock.module('@/features/issues/workspace-provider.tsx', () => ({
    ...workspaceProvider,
    useWorkspace: () => workspaceFixture(),
  }));
  mock.module('@/lib/query/use-issue-search.ts', () => ({
    useIssueSearch: () => ({
      issues: [issue({ id: 'issue_9', identifier: 'ENG-9', title: 'The parent to be' })],
      searching: false,
    }),
  }));
  mock.module('@/lib/query/use-issues.ts', () => ({
    ...issuesQuery,
    useBootstrap: () => ({ data: undefined }),
    useUpdateIssue: () => ({
      mutate: (input: { patch: Record<string, unknown> }) => patched.push(input.patch),
      mutateAsync: (input: { patch: Record<string, unknown> }) => {
        patched.push(input.patch);
        return Promise.resolve(issue());
      },
      isPending: false,
    }),
    useCreateIssue: () => ({
      mutate: (input: Record<string, unknown>, options?: { onSuccess?: (next: Issue) => void }) => {
        created.push(input);
        options?.onSuccess?.(issue({ id: 'issue_2', identifier: 'ENG-2' }));
      },
      isPending: false,
    }),
  }));
});

const { IssueProperties } = await import('@/features/issues/issue-properties.tsx');
const { SubIssues } = await import('@/features/issues/sub-issues.tsx');
const { calendarDateOf, DueDateField, dueDateLabel, isCalendarDate } = await import(
  '@/features/issues/due-date-field.tsx'
);
const { pickableIssues } = await import('@/features/issues/issue-picker.tsx');

describe('due date field', () => {
  it('accepts a real calendar day and rejects a fake one', () => {
    expect(isCalendarDate('2031-03-04')).toBe(true);
    expect(isCalendarDate('2031-02-30')).toBe(false);
    expect(isCalendarDate('04-03-2031')).toBe(false);
  });

  it('reads a stored due date back as the same day', () => {
    expect(calendarDateOf('2031-03-04')).toBe('2031-03-04');
    expect(calendarDateOf(null)).toBe('');
    expect(dueDateLabel(null)).toBe('No due date');
    expect(dueDateLabel('2031-03-04')).toContain('2031');
  });

  it('reports only a day the calendar really has', async () => {
    const seen: (string | null)[] = [];
    render(
      <DueDateField
        value={null}
        open
        onOpenChange={() => undefined}
        onChange={(next) => seen.push(next)}
        triggerClassName="trigger"
      />,
    );

    const input = await screen.findByTestId('due-date-input');
    fireEvent.change(input, { target: { value: '2031-02-30' } });
    expect(seen).toEqual([]);

    fireEvent.change(input, { target: { value: '2031-03-04' } });
    expect(seen).toEqual(['2031-03-04']);
  });

  it('clears the day when the field is emptied', async () => {
    const seen: (string | null)[] = [];
    render(
      <DueDateField
        value="2031-03-04"
        open
        onOpenChange={() => undefined}
        onChange={(next) => seen.push(next)}
        triggerClassName="trigger"
      />,
    );

    fireEvent.change(await screen.findByTestId('due-date-input'), { target: { value: '' } });
    expect(seen).toEqual([null]);
  });
});

describe('issue picker options', () => {
  it('never offers an issue that is already taken', () => {
    const options = [issue(), issue({ id: 'issue_2', identifier: 'ENG-2' })];
    expect(pickableIssues(options, ['issue_1']).map((entry) => entry.id)).toEqual(['issue_2']);
  });
});

describe('IssueProperties due date', () => {
  it('sends the day the person picked to the server', async () => {
    render(
      <HotkeyProvider>
        <IssueProperties issue={issue()} />
      </HotkeyProvider>,
    );

    fireEvent.click(screen.getByTestId('property-due-date'));
    fireEvent.change(await screen.findByTestId('due-date-input'), {
      target: { value: '2031-03-04' },
    });

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ dueDate: '2031-03-04' });
  });

  it('clears the due date without inventing a value', async () => {
    render(
      <HotkeyProvider>
        <IssueProperties issue={issue({ dueDate: '2031-03-04' })} />
      </HotkeyProvider>,
    );

    fireEvent.click(screen.getByTestId('property-due-date'));
    fireEvent.click(await screen.findByTestId('due-date-clear'));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ dueDate: null });
  });
});

describe('IssueProperties parent', () => {
  it('shows the parent the server resolved, not the raw id', () => {
    render(
      <HotkeyProvider>
        <IssueProperties
          issue={issue({ parentId: 'issue_9' })}
          parent={issue({ id: 'issue_9', identifier: 'ENG-9', title: 'The epic' })}
        />
      </HotkeyProvider>,
    );

    expect(screen.getByTestId('property-parent')).toHaveTextContent('ENG-9');
  });

  it('detaches the parent through the server', async () => {
    render(
      <HotkeyProvider>
        <IssueProperties
          issue={issue({ parentId: 'issue_9' })}
          parent={issue({ id: 'issue_9', identifier: 'ENG-9', title: 'The epic' })}
        />
      </HotkeyProvider>,
    );

    fireEvent.click(screen.getByTestId('clear-parent'));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ parentId: null });
  });

  it('offers no detach control when the issue has no parent', () => {
    render(
      <HotkeyProvider>
        <IssueProperties issue={issue()} />
      </HotkeyProvider>,
    );

    expect(screen.getByTestId('property-parent')).toHaveTextContent('No parent');
    expect(screen.queryByTestId('clear-parent')).toBeNull();
  });
});

describe('SubIssues', () => {
  it('creates a child that carries the parent id the server will enforce', async () => {
    render(
      <HotkeyProvider>
        <SubIssues issue={issue({ projectId: 'project_1', cycleId: 'cycle_1' })} subIssues={[]} />
      </HotkeyProvider>,
    );

    fireEvent.click(screen.getByTestId('add-sub-issue'));
    fireEvent.change(await screen.findByTestId('sub-issue-title'), {
      target: { value: 'Wire the socket' },
    });
    fireEvent.click(screen.getByTestId('sub-issue-submit'));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      teamId: 'team_1',
      title: 'Wire the socket',
      parentId: 'issue_1',
      projectId: 'project_1',
      cycleId: 'cycle_1',
    });
  });

  it('offers a way to adopt an existing issue without creating a new one', () => {
    render(
      <HotkeyProvider>
        <SubIssues issue={issue()} subIssues={[]} />
      </HotkeyProvider>,
    );

    expect(screen.getByTestId('link-sub-issue')).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });

  it('lists the children the server sent', () => {
    render(
      <HotkeyProvider>
        <SubIssues
          issue={issue()}
          subIssues={[issue({ id: 'issue_2', identifier: 'ENG-2', title: 'Child work' })]}
        />
      </HotkeyProvider>,
    );

    expect(screen.getByText('Child work')).toBeInTheDocument();
    expect(screen.getByText('ENG-2')).toBeInTheDocument();
  });
});

describe('choosing an issue from a picker', () => {
  it('sets the parent to the issue that was picked', async () => {
    render(
      <HotkeyProvider>
        <IssueProperties issue={issue()} />
      </HotkeyProvider>,
    );

    fireEvent.click(screen.getByTestId('property-parent'));
    fireEvent.click(await screen.findByTestId('parent-picker-option-ENG-9'));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ parentId: 'issue_9' });
  });

  it('makes the picked issue a child, rather than repointing the issue being viewed', async () => {
    render(
      <HotkeyProvider>
        <SubIssues issue={issue()} subIssues={[]} />
      </HotkeyProvider>,
    );

    fireEvent.click(screen.getByTestId('link-sub-issue'));
    fireEvent.click(await screen.findByTestId('sub-issue-picker-option-ENG-9'));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ parentId: 'issue_1' });
  });
});
