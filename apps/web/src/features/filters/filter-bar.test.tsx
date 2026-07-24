import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { FilterCondition, FilterGroup } from '@orbit/shared/filters';
import { capabilityFor, conditionsOf, inCondition } from '@orbit/shared/filters';
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
import type { ViewControls } from './view-controls.tsx';

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

const controls: ViewControls = {
  capability: capabilityFor('team', 'list'),
  displayModified: false,
  config: null,
  layout: 'list',
  onChange: null,
};

function groupOf(...conditions: FilterCondition[]): FilterGroup {
  return { kind: 'group', combinator: 'and', children: conditions };
}

function renderBar(conditions: readonly FilterCondition[] = []) {
  const config: ViewConfig = { ...defaultViewConfig('list'), filter: groupOf(...conditions) };
  render(
    <Providers>
      <FilterBar
        teamId="team-1"
        teamName="Engineering"
        layout="list"
        config={config}
        onChange={onChange}
        controls={controls}
      />
    </Providers>,
  );
  return config;
}

function lastConditions(): readonly FilterCondition[] {
  const call = onChange.mock.calls.at(-1);
  const next = call?.[0] as ViewConfig | undefined;
  return next === undefined ? [] : conditionsOf(next.filter);
}

beforeEach(() => {
  onChange.mockClear();
});

describe('filter chips', () => {
  it('describes each condition and names its controls', () => {
    renderBar([inCondition('assignee', ['user-2']), inCondition('priority', ['1', '2'], true)]);

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
    renderBar([inCondition('assignee', ['user-2']), inCondition('priority', ['1'])]);

    await user.click(screen.getByTestId('remove-filter-assignee'));
    expect(lastConditions().map((entry) => entry.property)).toEqual(['priority']);
  });

  it('clears everything from the clear button', async () => {
    const user = userEvent.setup();
    renderBar([inCondition('assignee', ['user-2'])]);

    await user.click(screen.getByTestId('clear-filters'));
    expect(lastConditions()).toEqual([]);
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

  it('drops only the last condition on Shift+F', async () => {
    const user = userEvent.setup();
    renderBar([
      inCondition('assignee', ['user-2']),
      inCondition('priority', ['1']),
      inCondition('due', ['overdue']),
    ]);

    await user.keyboard('{Shift>}F{/Shift}');
    expect(lastConditions().map((entry) => entry.property)).toEqual(['assignee', 'priority']);
    expect(screen.queryByTestId('filter-menu')).not.toBeInTheDocument();
  });

  it('clears every condition on Alt+Shift+F', async () => {
    const user = userEvent.setup();
    renderBar([inCondition('assignee', ['user-2']), inCondition('priority', ['1'])]);

    await user.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}');
    expect(lastConditions()).toEqual([]);
  });

  it('opens the save view dialog on Alt+V', async () => {
    const user = userEvent.setup();
    renderBar([inCondition('assignee', ['user-2'])]);

    await user.keyboard('{Alt>}v{/Alt}');
    await waitFor(() => expect(screen.getByTestId('save-view-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('save-view-name')).toHaveValue('Engineering: Aditi Rao');
    expect(screen.getByTestId('save-view-visibility-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('save-view-locked')).toBeInTheDocument();
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
          controls={controls}
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

    for (let step = 0; step < 40; step += 1) {
      if (screen.getByTestId('filter-field-label').getAttribute('data-selected') === 'true') break;
      await user.keyboard('{ArrowDown}');
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('filter-value-label-bug')).toHaveAttribute('data-selected', 'true'),
    );

    await user.keyboard('{Enter}');
    expect(lastConditions()).toEqual([inCondition('label', ['label-bug'])]);
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
    expect(options.length).toBeGreaterThanOrEqual(2);
    const assigneeOption = options[0];
    if (assigneeOption === undefined) throw new Error('The assignee option was not rendered.');
    await user.click(assigneeOption);
    expect(lastConditions()).toEqual([inCondition('assignee', ['user-2'])]);
  });

  it('negates a property from the value picker', async () => {
    const user = userEvent.setup();
    renderBar([inCondition('priority', ['1'])]);

    await user.click(screen.getByRole('button', { name: /Edit filter: Priority/ }));
    await user.click(await screen.findByTestId('filter-toggle-operator'));

    expect(lastConditions()).toEqual([inCondition('priority', ['1'], true)]);
  });

  it('offers a relative window on a date dimension and commits it', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard('f');
    await user.click(await screen.findByTestId('filter-field-due'));
    await user.click(await screen.findByTestId('filter-relative-next-2-week'));

    const committed = lastConditions()[0];
    expect(committed?.property).toBe('due');
    expect(committed?.operator).toBe('relative');
    if (committed?.operator !== 'relative') throw new Error('The relative filter was not saved.');
    expect(committed.relative).toEqual({ unit: 'week', offset: 2, direction: 'future' });
  });

  it('commits a free text content filter', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard('f');
    await user.click(await screen.findByTestId('filter-field-content'));
    await user.keyboard('redirect');
    await user.click(await screen.findByTestId('filter-content-apply'));

    const committed = lastConditions()[0];
    expect(committed?.property).toBe('content');
    if (committed?.operator !== 'exact') throw new Error('The content filter was not saved.');
    expect(committed.value).toBe('redirect');
  });

  it('exposes every dimension the data model supports', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.keyboard('f');
    await screen.findByTestId('filter-menu');
    for (const property of [
      'state',
      'assignee',
      'creator',
      'priority',
      'estimate',
      'label',
      'project',
      'milestone',
      'relation',
      'link',
      'subscriber',
      'content',
      'due',
      'created',
      'updated',
      'started',
      'completed',
    ]) {
      expect(screen.getByTestId(`filter-field-${property}`)).toBeInTheDocument();
    }
  });
});
