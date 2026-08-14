import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import * as realtimeReact from '@orbit/realtime-client/react';
import type { ReactNode } from 'react';
import type { PullRequestRow } from '@/features/pulls/data.ts';
import { PULL_REFRESH_INTERVAL_MS } from '@/features/pulls/use-pull-refresh.ts';
import { render, screen, within } from '@/test/render.tsx';

const refresh = mock(() => undefined);
const providerMount = mock(({ children }: { readonly children: ReactNode }) => children);

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh, prefetch: mock() }),
  usePathname: () => '/pulls',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

mock.module('@orbit/realtime-client/react', () => ({
  ...realtimeReact,
  RealtimeProvider: providerMount,
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

const { PullsView } = await import('@/features/pulls/pulls-view.tsx');
const { PullsRealtime } = await import('@/features/pulls/pulls-realtime.tsx');

const pull: PullRequestRow = {
  id: 'link_1',
  title: 'Buffer the socket until the hub attaches',
  url: 'https://github.com/noveum/orbit/pull/42',
  repository: 'noveum/orbit',
  number: 42,
  branch: 'fix/socket-buffer',
  state: 'open',
  draft: false,
  merged: false,
  authorLogin: 'octocat',
  reviewDecision: null,
  checkStatus: 'success',
  activityCount: 4,
  linkedIssues: [
    {
      identifier: 'ENG-12',
      title: 'Reconnect banner never clears',
      project: { id: 'project_1', name: 'Realtime reliability', slug: 'realtime-reliability' },
    },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  refresh.mockClear();
  providerMount.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PullsView', () => {
  it('uses the workspace realtime connection instead of opening another socket', () => {
    render(
      <PullsRealtime
        pulls={[pull]}
        total={250}
        userId="user_1"
        reach="connected"
        canManageIntegrations
        currentPage={1}
        hasMore={false}
      />,
    );

    expect(providerMount).not.toHaveBeenCalled();
    expect(screen.getByTestId('pulls-count')).toHaveTextContent('250');
  });

  it('links the issue behind each pull request, identifier and title together', () => {
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    const link = screen.getByTestId('pull-issue-ENG-12');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/issue/ENG-12');
    expect(link.textContent).toContain('ENG-12');
    expect(link.textContent).toContain('Reconnect banner never clears');
  });

  it('opens the Orbit activity view from the pull request title', () => {
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    const row = screen.getByRole('listitem');
    const overview = within(row).getByRole('link', {
      name: 'Buffer the socket until the hub attaches',
    });
    expect(overview).toHaveAttribute('href', '/pulls/link_1');
  });

  it('keeps an explicit link to the pull request on GitHub', () => {
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    expect(screen.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/noveum/orbit/pull/42',
    );
  });

  it('shows the linked project beside the linked Orbit task', () => {
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    expect(screen.getByRole('link', { name: 'Realtime reliability' })).toHaveAttribute(
      'href',
      '/projects/realtime-reliability',
    );
  });

  it('refreshes pull request state when the workspace regains focus', () => {
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    window.dispatchEvent(new Event('focus'));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes visible tabs on the interval and leaves hidden tabs alone', () => {
    jest.useFakeTimers();
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    jest.advanceTimersByTime(PULL_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    jest.advanceTimersByTime(PULL_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(
      document,
      'visibilityState',
      visibility ?? { configurable: true, value: 'visible' },
    );
  });

  it('provides explicit navigation when more pull requests exist', () => {
    render(
      <PullsView
        pulls={[pull]}
        userId="user_1"
        reach="connected"
        canManageIntegrations
        currentPage={2}
        hasMore
      />,
    );

    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/pulls');
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/pulls?page=3');
  });
});

describe('the empty pull request page explaining itself', () => {
  it('offers a way to connect when GitHub was never installed', () => {
    render(<PullsView pulls={[]} userId="user_1" reach="not_installed" canManageIntegrations />);

    expect(screen.getByText('GitHub is not connected yet')).toBeInTheDocument();
    expect(screen.getByTestId('pulls-connect-github')).toHaveAttribute(
      'href',
      '/settings/integrations',
    );
  });

  it('asks for repositories when the app is installed but none is tracked', () => {
    render(<PullsView pulls={[]} userId="user_1" reach="no_repositories" canManageIntegrations />);

    expect(screen.getByText('No repository is being tracked')).toBeInTheDocument();
    expect(screen.getByTestId('pulls-connect-github')).toBeInTheDocument();
  });

  it('says the installation is suspended rather than asking for repositories', () => {
    render(<PullsView pulls={[]} userId="user_1" reach="suspended" canManageIntegrations />);

    expect(screen.getByText('The GitHub installation is suspended')).toBeInTheDocument();
    expect(screen.queryByText('No repository is being tracked')).not.toBeInTheDocument();
  });

  it('says the mirror is waiting once every repository is tracked', () => {
    render(<PullsView pulls={[]} userId="user_1" reach="connected" canManageIntegrations />);

    expect(screen.getByText('No pull requests have synced yet')).toBeInTheDocument();
    expect(screen.getByText(/tracked repositories/)).toBeInTheDocument();
  });

  it('offers the route to integrations when a connected mirror stays empty', () => {
    render(<PullsView pulls={[]} userId="user_1" reach="connected" canManageIntegrations />);

    expect(screen.getByTestId('pulls-connect-github')).toHaveAttribute(
      'href',
      '/settings/integrations',
    );
  });

  it('explains that additional repositories still need to be tracked', () => {
    render(
      <PullsView pulls={[]} userId="user_1" reach="repositories_untracked" canManageIntegrations />,
    );

    expect(screen.getByText(/additional repositories/)).toBeInTheDocument();
    expect(screen.getByText(/refresh to import their open pull requests/)).toBeInTheDocument();
    expect(screen.getByTestId('pulls-connect-github')).toBeInTheDocument();
  });

  it('tells a member who cannot track repositories to ask an admin', () => {
    render(
      <PullsView
        pulls={[]}
        userId="user_1"
        reach="repositories_untracked"
        canManageIntegrations={false}
      />,
    );

    expect(screen.getByText(/workspace admin chooses which repositories/)).toBeInTheDocument();
    expect(screen.queryByTestId('pulls-connect-github')).not.toBeInTheDocument();
  });

  it('never requires an Orbit issue identifier for an untracked repository', () => {
    render(
      <PullsView pulls={[]} userId="user_1" reach="repositories_untracked" canManageIntegrations />,
    );

    expect(screen.queryByText(/name an issue/)).toBeNull();
  });

  it('sends a member who cannot manage integrations to an admin rather than a dead end', () => {
    render(
      <PullsView pulls={[]} userId="user_1" reach="not_installed" canManageIntegrations={false} />,
    );

    expect(screen.getByText(/workspace admin needs to connect GitHub/)).toBeInTheDocument();
    expect(screen.queryByTestId('pulls-connect-github')).not.toBeInTheDocument();
  });
});
