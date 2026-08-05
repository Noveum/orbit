import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';

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
mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { QuickCreateDialog } = await import('@/features/issues/quick-create.tsx');

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
    projects: [
      {
        id: 'proj_1',
        name: 'API market',
        status: 'started',
        color: '#00f',
        icon: 'box',
        teamIds: ['team_eng'],
      },
      {
        id: 'proj_2',
        name: 'Brand refresh',
        status: 'started',
        color: '#0f0',
        icon: 'box',
        teamIds: ['team_des'],
      },
    ],
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
  it('offers only the projects the chosen team can actually use', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.click(screen.getByTestId('quick-create-project'));

    expect(await screen.findByText('API market')).toBeTruthy();
    expect(screen.queryByText('Brand refresh')).toBeNull();
  });

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

  it('carries the project and sprint that were actually chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Ship the thing');
    await user.click(screen.getByTestId('quick-create-project'));
    await user.click(await screen.findByText('API market'));
    await user.click(screen.getByTestId('quick-create-cycle'));
    await user.click(await screen.findByText('Sprint 3'));
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created).toHaveBeenCalledTimes(1);
    const input = created.mock.calls[0]?.[0];
    expect(input?.['title']).toBe('Ship the thing');
    expect(input?.['projectId']).toBe('proj_1');
    expect(input?.['cycleId']).toBe('cycle_1');
  });

  it('stays open and clears the title when Create more is on', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.click(screen.getByTestId('quick-create-more'));
    await user.type(screen.getByTestId('quick-create-title'), 'First one');
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('quick-create-title')).toHaveValue('');
    expect(screen.getByTestId('quick-create')).toBeTruthy();
  });

  it('drops the sprint and the project from the team that was left behind', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = {
      ...buildWorkspace(),
      teams: [
        { id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#fff' },
        { id: 'team_des', name: 'Design', key: 'DES', icon: 'd', color: '#eee' },
      ],
    };
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Moved teams');
    await user.click(screen.getByTestId('quick-create-project'));
    await user.click(await screen.findByText('API market'));
    await user.click(screen.getByTestId('quick-create-cycle'));
    await user.click(await screen.findByText('Sprint 3'));
    await user.click(screen.getByTestId('quick-create-team'));
    await user.click(await screen.findByText('Design'));
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]?.['cycleId']).toBeNull();
    expect(created.mock.calls[0]?.[0]?.['projectId']).toBeNull();
  });
});
