import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberView, TeamDetail } from '@/features/settings/data.ts';
import { TeamSettingsPanel } from '../../../src/features/settings/team-settings-panel.tsx';
import { TeamsPanel } from '../../../src/features/settings/teams-panel.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/team/eng/settings',
}));

const members: readonly MemberView[] = [
  { userId: 'user_1', name: 'Shashank', email: 'shashank@noveum.ai', image: null, role: 'admin' },
  { userId: 'user_2', name: 'Pulkit', email: 'pulkit@noveum.ai', image: null, role: 'member' },
] as unknown as readonly MemberView[];

function team(overrides: Partial<TeamDetail> = {}): TeamDetail {
  return {
    id: 'team_1',
    key: 'ENG',
    name: 'Engineering',
    color: '#5a63c8',
    icon: 'circle',
    description: '',
    archivedAt: null,
    memberIds: ['user_1'],
    ...overrides,
  } as unknown as TeamDetail;
}

const originalFetch = globalThis.fetch;
const requests: { url: string; method: string }[] = [];
const user = userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  requests.length = 0;
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET' });
    return Promise.resolve(Response.json({ team: {} }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('TeamSettingsPanel', () => {
  it('asks before archiving, and archives only once confirmed', async () => {
    render(<TeamSettingsPanel team={team()} members={members} canManage />);

    await user.click(screen.getByTestId('archive-team'));
    await screen.findByTestId('archive-team-dialog');
    expect(requests).toEqual([]);

    await user.click(screen.getByTestId('confirm-archive-team'));

    expect(requests).toEqual([{ url: '/api/teams/team_1', method: 'DELETE' }]);
  });

  it('offers a restore rather than a second archive once the team is archived', async () => {
    render(
      <TeamSettingsPanel
        team={team({ archivedAt: '2026-01-01T00:00:00.000Z' })}
        members={members}
        canManage
      />,
    );

    expect(screen.queryByTestId('archive-team')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('restore-team'));

    expect(requests).toEqual([{ url: '/api/teams/team_1/restore', method: 'POST' }]);
  });

  it('adds and removes a member against the endpoint that matches', async () => {
    render(<TeamSettingsPanel team={team()} members={members} canManage />);

    await user.click(screen.getByLabelText('Pulkit on Engineering'));
    expect(requests).toEqual([{ url: '/api/teams/team_1/members', method: 'POST' }]);

    requests.length = 0;
    await user.click(screen.getByLabelText('Shashank on Engineering'));
    expect(requests).toEqual([{ url: '/api/teams/team_1/members/user_1', method: 'DELETE' }]);
  });

  it('keeps save inert until something actually changed', async () => {
    render(<TeamSettingsPanel team={team()} members={members} canManage />);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Name'), 'x');

    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('offers nothing to a role that cannot manage teams', () => {
    render(<TeamSettingsPanel team={team()} members={members} canManage={false} />);

    expect(screen.getByTestId('archive-team')).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Pulkit on Engineering')).toBeDisabled();
  });
});

describe('reaching an archived team again', () => {
  it('keeps a settings link on every team in the workspace list, archived ones included', () => {
    render(
      <TeamsPanel
        teams={[
          team(),
          team({
            id: 'team_2',
            key: 'DES',
            name: 'Design',
            archivedAt: '2026-01-01T00:00:00.000Z',
          }),
        ]}
        members={members}
        canManage
      />,
    );

    expect(screen.getByTestId('team-settings-link-ENG')).toHaveAttribute(
      'href',
      '/team/eng/settings',
    );
    expect(screen.getByTestId('team-settings-link-DES')).toHaveAttribute(
      'href',
      '/team/des/settings',
    );
  });
});
