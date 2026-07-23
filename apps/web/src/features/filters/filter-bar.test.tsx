import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { FilterPredicate } from '@orbit/shared/filters';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider, useHotkey } from '@/lib/keyboard/index.ts';
import { createQueryClient } from '@/lib/query/provider.tsx';
import { FilterBar } from './filter-bar.tsx';
import { defaultViewConfig, type ViewConfig } from './view-config.ts';

const workspace: WorkspaceData = {
  ready: true,
  userId: 'user-1',
  teams: [{ id: 'team-1', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
  states: [
    {
      id: 'state-todo',
      teamId: 'team-1',
      name: 'Todo',
      category: 'unstarted',
      color: '#5d6272',
      position: 1,
    },
    {
      id: 'state-done',
      teamId: 'team-1',
      name: 'Done',
      category: 'completed',
      color: '#2e9e68',
      position: 2,
    },
  ],
  labels: [{ id: 'label-bug', teamId: null, name: 'Bug', color: '#cc4b4b' }],
  members: [
    {
      id: 'user-1',
      name: 'Pulkit Sharma',
      email: 'pulkit@noveum.ai',
      image: null,
      handle: 'pulkit',
      role: 'admin',
    },
    {
      id: 'user-2',
      name: 'Aditi Rao',
      email: 'aditi@noveum.ai',
      image: null,
      handle: 'aditi',
      role: 'member',
    },
  ],
  projects: [{ id: 'project-1', name: 'Atlas', status: 'planned', color: '#5a63c8', icon: 'box' }],
  cycles: [],
  seedIssues: [],
  stateById: new Map(),
  labelById: new Map(),
  memberById: new Map(),
  openQuickCreate: () => undefined,
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <HotkeyProvider>{children}</HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const onChange = mock();

function renderBar(predicates: readonly FilterPredicate[] = []) {
  const config: ViewConfig = { ...defaultViewConfig('list'), predicates };
  render(
    <Providers>
      <FilterBar
        teamId="team-1"
        teamName="Engineering"
        layout="list"
        config={config}
        onChange={onChange}
      />
    </Providers>,
  );
  return config;
}

function lastPredicates(): readonly FilterPredicate[] {
  const call = onChange.mock.calls.at(-1);
  const next = call?.[0] as ViewConfig | undefined;
  return next?.predicates ?? [];
}

beforeEach(() => {
  onChange.mockClear();
});

describe('filter chips', () => {
  it('describes each predicate and names its controls', () => {
    renderBar([
      { field: 'assignee', operator: 'is', values: ['user-2'] },
      { field: 'priority', operator: 'is_not', values: ['1', '2'] },
    ]);

    expect(
      screen.getByRole('button', { name: 'Edit filter: Assignee is Aditi Rao' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit filter: Priority is not any of Urgent +1' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove filter: Assignee is Aditi Rao' }),
    ).toBeInTheDocument();
  });

  it('removes just the chip whose remove button was pressed', async () => {
    const user = userEvent.setup();
    renderBar([
      { field: 'assignee', operator: 'is', values: ['user-2'] },
      { field: 'priority', operator: 'is', values: ['1'] },
    ]);

    await user.click(screen.getByTestId('remove-filter-assignee'));
    expect(lastPredicates().map((entry) => entry.field)).toEqual(['priority']);
  });

  it('clears everything from the clear button', async () => {
    const user = userEvent.setup();
    renderBar([{ field: 'assignee', operator: 'is', values: ['user-2'] }]);

    await user.click(screen.getByTestId('clear-filters'));
    expect(lastPredicates()).toEqual([]);
  });
});

describe('filter hotkeys', () => {
  it('opens the menu on F', async () => {
    const user = userEvent.setup();
    renderBar();

    expect(screen.queryByTestId('filter-menu')).not.toBeInTheDocument();
    await user.keyboard('f');
    await waitFor(() => expect(screen.getByTestId('filter-menu')).toBeInTheDocument());
  });

  it('drops only the last predicate on Shift+F', async () => {
    const user = userEvent.setup();
    renderBar([
      { field: 'assignee', operator: 'is', values: ['user-2'] },
      { field: 'priority', operator: 'is', values: ['1'] },
      { field: 'due', operator: 'is', values: ['overdue'] },
    ]);

    await user.keyboard('{Shift>}F{/Shift}');
    expect(lastPredicates().map((entry) => entry.field)).toEqual(['assignee', 'priority']);
    expect(screen.queryByTestId('filter-menu')).not.toBeInTheDocument();
  });

  it('clears every predicate on Alt+Shift+F', async () => {
    const user = userEvent.setup();
    renderBar([
      { field: 'assignee', operator: 'is', values: ['user-2'] },
      { field: 'priority', operator: 'is', values: ['1'] },
    ]);

    await user.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}');
    expect(lastPredicates()).toEqual([]);
  });

  it('opens the save view dialog on Alt+V', async () => {
    const user = userEvent.setup();
    renderBar([{ field: 'assignee', operator: 'is', values: ['user-2'] }]);

    await user.keyboard('{Alt>}v{/Alt}');
    await waitFor(() => expect(screen.getByTestId('save-view-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('save-view-name')).toHaveValue('Engineering: Aditi Rao');
  });
});

function SelectionOwner({ onClear }: { readonly onClear: () => void }) {
  useHotkey('escape', onClear, {
    label: 'Clear selection',
    section: 'Issues',
    scope: 'issues',
    preventDefault: false,
  });
  return null;
}

describe('escape ownership', () => {
  it('closes the filter menu first and only then clears the selection', async () => {
    const user = userEvent.setup();
    const onClear = mock();
    render(
      <Providers>
        <SelectionOwner onClear={onClear} />
        <FilterBar
          teamId="team-1"
          teamName="Engineering"
          layout="list"
          config={defaultViewConfig('list')}
          onChange={onChange}
        />
      </Providers>,
    );

    await user.keyboard('f');
    await waitFor(() => expect(screen.getByTestId('filter-menu')).toBeInTheDocument());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('filter-menu')).not.toBeInTheDocument());
    expect(onClear).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('filter menu keyboard operation', () => {
  it('walks the field list with the arrow keys and picks with enter', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard('f');
    const input = await screen.findByTestId('filter-menu-input');
    expect(input).toHaveFocus();

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('filter-value-label-bug')).toHaveAttribute('data-selected', 'true'),
    );

    await user.keyboard('{Enter}');
    expect(lastPredicates()).toEqual([{ field: 'label', operator: 'is', values: ['label-bug'] }]);
  });

  it('narrows across filter names and their values as you type', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard('f');
    await screen.findByTestId('filter-menu-input');
    await user.keyboard('Aditi');

    await waitFor(() =>
      expect(screen.queryByTestId('filter-field-priority')).not.toBeInTheDocument(),
    );
    const options = await screen.findAllByRole('option', { name: /Aditi Rao/ });
    expect(options).toHaveLength(2);
    const assigneeOption = options[0];
    if (assigneeOption === undefined) throw new Error('The assignee option was not rendered.');
    await user.click(assigneeOption);
    expect(lastPredicates()).toEqual([{ field: 'assignee', operator: 'is', values: ['user-2'] }]);
  });

  it('negates a field from the value picker', async () => {
    const user = userEvent.setup();
    renderBar([{ field: 'priority', operator: 'is', values: ['1'] }]);

    await user.click(screen.getByRole('button', { name: /Edit filter: Priority/ }));
    await user.click(await screen.findByTestId('filter-toggle-operator'));

    expect(lastPredicates()).toEqual([{ field: 'priority', operator: 'is_not', values: ['1'] }]);
  });
});
