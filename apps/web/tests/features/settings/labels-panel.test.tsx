import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LabelView, TeamBadge } from '../../../src/features/settings/data.ts';
import { LabelsPanel } from '../../../src/features/settings/labels-panel.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const TEAMS: TeamBadge[] = [
  { id: 'team-1', key: 'ENG', name: 'Engineering' },
  { id: 'team-2', key: 'DSGN', name: 'Design' },
];

const LABELS: LabelView[] = [
  { id: 'label-1', name: 'Flaky', color: '#EF4444', teamId: null },
  { id: 'label-2', name: 'Pixel polish', color: '#EC4899', teamId: 'team-2' },
];

const realFetch = globalThis.fetch;

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

let sent: Sent[] = [];

function respondWith(status: number, payload: unknown): void {
  globalThis.fetch = mock((url: string, init: { method: string; body?: string }) => {
    sent.push({
      url,
      method: init.method,
      body: init.body === undefined ? {} : (JSON.parse(init.body) as Record<string, unknown>),
    });
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(payload),
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  refresh.mockClear();
  sent = [];
  respondWith(200, {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('LabelsPanel', () => {
  it('creates a workspace label with the name and the colour the form holds', async () => {
    const user = userEvent.setup();
    render(<LabelsPanel labels={[]} teams={TEAMS} canManage />);

    await user.type(screen.getByLabelText('Label name'), 'Regression');
    await user.click(screen.getByRole('button', { name: '#22C55E' }));
    await user.click(screen.getByRole('button', { name: 'Create label' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/api/labels');
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.body).toEqual({ name: 'Regression', color: '#22C55E', teamId: null });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('patches the label the row is for, and nothing else', async () => {
    const user = userEvent.setup();
    render(<LabelsPanel labels={LABELS} teams={TEAMS} canManage />);

    const rows = screen.getAllByTestId('label-row');
    const second = rows[1];
    if (second === undefined) throw new Error('the second label row is missing');
    await user.click(within(second).getByRole('button', { name: 'Edit' }));

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Polish');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/api/labels/label-2');
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.body).toEqual({ name: 'Polish', color: '#EC4899', teamId: 'team-2' });
  });

  it('deletes the label the row is for', async () => {
    const user = userEvent.setup();
    render(<LabelsPanel labels={LABELS} teams={TEAMS} canManage />);

    const rows = screen.getAllByTestId('label-row');
    const first = rows[0];
    if (first === undefined) throw new Error('the first label row is missing');
    await user.click(within(first).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/api/labels/label-1');
    expect(sent[0]?.method).toBe('DELETE');
  });

  it('shows what the server refused rather than pretending it worked', async () => {
    respondWith(409, {
      error: { code: 'conflict', message: 'A label with that name already lives here.' },
    });
    const user = userEvent.setup();
    render(<LabelsPanel labels={[]} teams={TEAMS} canManage />);

    await user.type(screen.getByLabelText('Label name'), 'Flaky');
    await user.click(screen.getByRole('button', { name: 'Create label' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A label with that name already lives here.',
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('names the team a label is pinned to, and calls the workspace one workspace', () => {
    render(<LabelsPanel labels={LABELS} teams={TEAMS} canManage />);

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('DSGN')).toBeInTheDocument();
  });

  it('disables every write when the viewer cannot manage labels', () => {
    render(<LabelsPanel labels={LABELS} teams={TEAMS} canManage={false} />);

    expect(screen.getByLabelText('Label name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create label' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Delete' })) {
      expect(button).toBeDisabled();
    }
  });
});
