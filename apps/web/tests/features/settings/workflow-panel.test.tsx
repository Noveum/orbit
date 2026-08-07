import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TeamBadge, WorkflowStateView } from '../../../src/features/settings/data.ts';
import { WorkflowPanel } from '../../../src/features/settings/workflow-panel.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const TEAMS: TeamBadge[] = [{ id: 'team-1', key: 'ENG', name: 'Engineering' }];

const STATES: WorkflowStateView[] = [
  { id: 'state-1', teamId: 'team-1', name: 'Todo', category: 'unstarted', color: '#6B7280' },
  { id: 'state-2', teamId: 'team-1', name: 'In Progress', category: 'started', color: '#F2C94C' },
  { id: 'state-3', teamId: 'team-1', name: 'Done', category: 'completed', color: '#22C55E' },
].map((state, position) => ({ ...state, position }) as WorkflowStateView);

const OTHER_TEAM_STATE: WorkflowStateView = {
  id: 'state-9',
  teamId: 'team-2',
  name: 'Somebody else',
  category: 'unstarted',
  color: '#6B7280',
  position: 0,
};

const realFetch = globalThis.fetch;

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

let sent: Sent[] = [];
let responses: { status: number; payload: unknown }[] = [];

function installFetch(): void {
  globalThis.fetch = mock((url: string, init: { method: string; body?: string }) => {
    sent.push({
      url,
      method: init.method,
      body: init.body === undefined ? {} : (JSON.parse(init.body) as Record<string, unknown>),
    });
    const next = responses.shift() ?? { status: 200, payload: {} };
    return Promise.resolve({
      ok: next.status < 400,
      status: next.status,
      json: () => Promise.resolve(next.payload),
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  refresh.mockClear();
  sent = [];
  responses = [];
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function rowFor(name: string): HTMLElement {
  const row = screen
    .getAllByTestId('workflow-state-row')
    .find((candidate) => within(candidate).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

describe('WorkflowPanel', () => {
  it('creates a status on the chosen team without sending a position', async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel teams={TEAMS} states={STATES} canManage />);

    await user.type(screen.getByLabelText('Status name'), 'Blocked');
    await user.click(screen.getByRole('button', { name: 'Add status' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/api/workflow-states');
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.body).toEqual({
      teamId: 'team-1',
      name: 'Blocked',
      category: 'unstarted',
      color: '#6B7280',
    });
    expect(Object.keys(sent[0]?.body ?? {})).not.toContain('position');
  });

  it('sends the whole board order on a move, not just the status that moved', async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel teams={TEAMS} states={STATES} canManage />);

    await user.click(screen.getByRole('button', { name: 'Move In Progress earlier' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/api/workflow-states/reorder');
    expect(sent[0]?.body).toEqual({
      teamId: 'team-1',
      stateIds: ['state-2', 'state-1', 'state-3'],
    });
  });

  it('never offers a move past either end of the board', () => {
    render(<WorkflowPanel teams={TEAMS} states={STATES} canManage />);

    expect(screen.getByRole('button', { name: 'Move Todo earlier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Done later' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Todo later' })).toBeEnabled();
  });

  it('shows the board of the selected team only', () => {
    render(<WorkflowPanel teams={TEAMS} states={[...STATES, OTHER_TEAM_STATE]} canManage />);

    expect(screen.getAllByTestId('workflow-state-row')).toHaveLength(3);
    expect(screen.queryByText('Somebody else')).not.toBeInTheDocument();
  });

  it('asks the server first, then offers the move only once it has refused', async () => {
    responses = [
      {
        status: 409,
        payload: {
          error: {
            code: 'conflict',
            message: 'Name a status to move those issues to before deleting this one.',
          },
        },
      },
      { status: 200, payload: {} },
    ];
    const user = userEvent.setup();
    render(<WorkflowPanel teams={TEAMS} states={STATES} canManage />);

    expect(screen.queryByLabelText('Move its issues to')).not.toBeInTheDocument();

    await user.click(within(rowFor('Todo')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/api/workflow-states/state-1');
    expect(sent[0]?.method).toBe('DELETE');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name a status to move those issues to before deleting this one.',
    );

    await user.click(screen.getByRole('button', { name: 'Move and delete' }));

    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent[1]?.url).toBe('/api/workflow-states/state-1?moveToStateId=state-2');
    expect(sent[1]?.method).toBe('DELETE');
  });

  it('reports a refusal that is not about issues rather than offering a move', async () => {
    responses = [
      {
        status: 409,
        payload: {
          error: { code: 'forbidden', message: 'Your role cannot workflow manage.' },
        },
      },
    ];
    const user = userEvent.setup();
    render(<WorkflowPanel teams={TEAMS} states={STATES} canManage />);

    await user.click(within(rowFor('Todo')).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your role cannot workflow manage.');
    expect(screen.queryByLabelText('Move its issues to')).not.toBeInTheDocument();
  });

  it('patches a status through the row it belongs to', async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel teams={TEAMS} states={STATES} canManage />);

    await user.click(within(rowFor('In Progress')).getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Doing');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/api/workflow-states/state-2');
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.body).toEqual({
      name: 'Doing',
      category: 'started',
      color: '#F2C94C',
    });
  });

  it('disables every write when the viewer cannot manage the workflow', () => {
    render(<WorkflowPanel teams={TEAMS} states={STATES} canManage={false} />);

    expect(screen.getByLabelText('Status name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add status' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Todo later' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Delete' })) {
      expect(button).toBeDisabled();
    }
  });
});
