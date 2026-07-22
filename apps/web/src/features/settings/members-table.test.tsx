import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberView } from './data.ts';
import { MembersTable } from './members-table.tsx';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const MEMBERS: MemberView[] = [
  {
    memberId: 'member-1',
    userId: 'user-1',
    name: 'Pulkit Sharma',
    handle: 'pulkit',
    email: 'pulkit@noveum.ai',
    image: null,
    role: 'admin',
    joinedAt: '2026-01-04T00:00:00.000Z',
    teams: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }],
  },
  {
    memberId: 'member-2',
    userId: 'user-2',
    name: 'Aditi Rao',
    handle: 'aditi',
    email: 'aditi@noveum.ai',
    image: null,
    role: 'member',
    joinedAt: '2026-01-04T00:00:00.000Z',
    teams: [],
  },
];

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
      }),
    ),
  );
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MembersTable', () => {
  it('renders a row per member with handle, teams and joined date', () => {
    render(<MembersTable members={MEMBERS} canManage />);
    expect(screen.getByText('Pulkit Sharma')).toBeInTheDocument();
    expect(screen.getByText('@aditi')).toBeInTheDocument();
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getAllByText('4 Jan 2026')).toHaveLength(2);
  });

  it('disables the role select and remove button for non admins', () => {
    render(<MembersTable members={MEMBERS} canManage={false} />);
    expect(screen.getByLabelText('Role for Pulkit Sharma')).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Remove' })) {
      expect(button).toBeDisabled();
    }
  });

  it('surfaces the last admin conflict inline next to the member', async () => {
    mockFetch(409, {
      error: { code: 'conflict', message: 'A workspace needs at least one admin.' },
    });
    const user = userEvent.setup();
    render(<MembersTable members={MEMBERS} canManage />);

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0] as HTMLElement);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A workspace needs at least one admin.');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes after a successful role change', async () => {
    mockFetch(200, { member: { id: 'member-2', role: 'admin' } });
    const user = userEvent.setup();
    render(<MembersTable members={MEMBERS} canManage />);

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[1] as HTMLElement);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
