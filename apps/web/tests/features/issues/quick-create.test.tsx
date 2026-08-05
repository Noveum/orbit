import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '../../../src/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '../../../src/features/issues/workspace-provider.tsx';

const created = mock((_input: Record<string, unknown>) => undefined);

mock.module('@/lib/query/use-issues.ts', () => ({
  useCreateIssue: () => ({
    mutate: (input: Record<string, unknown>, options?: { onSuccess?: () => void }) => {
      created(input);
      options?.onSuccess?.();
    },
    isPending: false,
  }),
}));

let workspace: WorkspaceData;
mock.module('../../../src/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { QuickCreateDialog } = await import('../../../src/features/issues/quick-create.tsx');

function buildWorkspace(): WorkspaceData {
  return {
    ...({} as WorkspaceData),
    ready: true,
    teams: [{ id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#fff' }],
    states: [
      {
        id: 'state_todo',
        teamId: 'team_eng',
        name: 'Todo',
        category: 'unstarted',
        color: '#888',
        position: 1,
      },
    ],
    members: [
      { id: 'me', name: 'Shashank', email: 's@x.co', image: null, handle: 's', role: 'admin' },
    ],
    labels: [{ id: 'label_bug', teamId: 'team_eng', name: 'Bug', color: '#f00' }],
    projects: [{ id: 'proj_1', name: 'API market', status: 'started', color: '#00f', icon: 'box' }],
    cycles: [
      {
        id: 'cycle_1',
        teamId: 'team_eng',
        number: 3,
        name: '',
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-08-14T00:00:00.000Z',
        completedAt: null,
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  created.mockClear();
});

function open() {
  render(
    <ToastProvider>
      <QuickCreateDialog open onOpenChange={() => undefined} defaultTeamId="team_eng" />
    </ToastProvider>,
  );
}

describe('the new issue dialog', () => {
  it('says which team the issue is going into', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.getByTestId('quick-create-crumb')).toHaveTextContent('ENG');
    expect(screen.getByTestId('quick-create-crumb')).toHaveTextContent('New issue');
  });

  it('offers a project and a sprint, which it could not before', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.getByTestId('quick-create-project')).toBeTruthy();
    expect(screen.getByTestId('quick-create-cycle')).toBeTruthy();
  });

  it('shows no formatting toolbar above the description, the way Linear does not', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.queryByTestId('quick-create-description-toolbar')).toBeNull();
  });

  it('offers to stay open for the next issue instead of a cancel button', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.getByTestId('quick-create-more')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('carries the chosen project and sprint onto the issue it creates', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Ship the thing');
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created).toHaveBeenCalledTimes(1);
    const input = created.mock.calls[0]?.[0];
    expect(input?.['title']).toBe('Ship the thing');
    expect(input).toHaveProperty('projectId');
    expect(input).toHaveProperty('cycleId');
  });
});
