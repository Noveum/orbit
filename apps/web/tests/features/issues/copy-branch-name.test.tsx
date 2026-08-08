import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import type { Issue, Member } from '@/lib/query/schemas.ts';

const toast = mock();

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

function person(handle: string | null): Member {
  return {
    id: 'user_1',
    name: 'Shashank',
    email: 'shashank@noveum.ai',
    image: null,
    handle,
    role: 'admin',
  };
}

let workspace: WorkspaceData;

function workspaceValue(ready: boolean, handle: string | null): WorkspaceData {
  return {
    ready,
    userId: ready ? 'user_1' : null,
    role: 'admin',
    teams: [],
    states: [],
    labels: [],
    members: [],
    projects: [],
    cycles: [],
    seedIssues: [],
    stateById: new Map(),
    labelById: new Map(),
    memberById: ready ? new Map([['user_1', person(handle)]]) : new Map(),
    openQuickCreate: () => undefined,
  };
}

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { CopyBranchNameMenuItem, branchCopy, branchNameFor } = await import(
  '../../../src/features/issues/copy-branch-name.tsx'
);

describe('branchNameFor', () => {
  it('builds the name a developer would check out', () => {
    expect(
      branchNameFor({ identifier: 'ENG-42', title: 'Fan out delta packets' }, 'shashank'),
    ).toBe('shashank/eng-42-fan-out-delta-packets');
  });

  it('falls back to orbit when the person has no handle yet', () => {
    expect(branchNameFor({ identifier: 'ENG-42', title: 'Ship it' }, null)).toBe(
      'orbit/eng-42-ship-it',
    );
  });

  it('keeps the identifier when a title slugifies to nothing', () => {
    expect(branchNameFor({ identifier: 'ENG-7', title: '!!!' }, 'ada')).toBe('ada/eng-7');
  });

  it('lowercases the identifier so the branch reads the way git branches do', () => {
    expect(branchNameFor({ identifier: 'MKT-3', title: 'Launch' }, 'bo')).toBe('bo/mkt-3-launch');
  });

  it('trims a long title rather than producing an unusable branch', () => {
    const name = branchNameFor(
      {
        identifier: 'ENG-1',
        title: 'A title that goes on well past anything anybody would want to type out by hand',
      },
      'ada',
    );

    expect(name.startsWith('ada/eng-1-')).toBe(true);
    expect(name.length).toBeLessThanOrEqual('ada/eng-1-'.length + 48);
    expect(name.endsWith('-')).toBe(false);
  });
});

const member = { id: 'user_1', handle: 'shashank' };
const target = { identifier: 'ENG-42', title: 'Fan out delta packets' };

describe('branchCopy', () => {
  it('offers the signed in member branch once the workspace has loaded', () => {
    const state = branchCopy(
      { ready: true, userId: 'user_1', memberById: new Map([['user_1', member]]) },
      target,
    );

    expect(state).toEqual({ branch: 'shashank/eng-42-fan-out-delta-packets', ready: true });
  });

  it('withholds the copy until the workspace has loaded, so nobody takes the orbit fallback for their own handle', () => {
    const state = branchCopy({ ready: false, userId: null, memberById: new Map() }, target);

    expect(state.ready).toBe(false);
  });

  it('stays offered for a loaded member who has no handle set', () => {
    const state = branchCopy(
      {
        ready: true,
        userId: 'user_1',
        memberById: new Map([['user_1', { ...member, handle: null }]]),
      },
      target,
    );

    expect(state).toEqual({ branch: 'orbit/eng-42-fan-out-delta-packets', ready: true });
  });
});

function issue(): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 42,
    identifier: 'ENG-42',
    title: 'Fan out delta packets',
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
  };
}

const writeText = mock(() => Promise.resolve());
const user = userEvent.setup({ pointerEventsCheck: 0 });

function renderItem(): void {
  render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <CopyBranchNameMenuItem issue={issue()} />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

beforeEach(() => {
  toast.mockClear();
  writeText.mockClear();
  writeText.mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  workspace = workspaceValue(true, 'shashank');
});

describe('CopyBranchNameMenuItem', () => {
  it('puts the branch on the clipboard and says so', async () => {
    renderItem();

    await user.click(screen.getByTestId('copy-branch-name-ENG-42'));

    expect(writeText).toHaveBeenCalledWith('shashank/eng-42-fan-out-delta-packets');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Branch name copied',
        description: 'shashank/eng-42-fan-out-delta-packets',
      }),
    );
  });

  it('still shows the name when the browser refuses the clipboard, so it can be copied by hand', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    renderItem();

    await user.click(screen.getByTestId('copy-branch-name-ENG-42'));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not copy the branch name',
        description: 'shashank/eng-42-fan-out-delta-packets',
        tone: 'danger',
      }),
    );
  });

  it('copies nothing while the workspace is still loading', async () => {
    workspace = workspaceValue(false, null);
    renderItem();

    await user.click(screen.getByTestId('copy-branch-name-ENG-42'));

    expect(writeText).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
