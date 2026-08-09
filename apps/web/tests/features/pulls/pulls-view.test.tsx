import { describe, expect, it, mock } from 'bun:test';
import * as realtimeReact from '@orbit/realtime-client/react';
import type { PullRequestRow } from '@/features/pulls/data.ts';
import { render, screen, within } from '@/test/render.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/pulls',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

mock.module('@orbit/realtime-client/react', () => ({
  ...realtimeReact,
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

const { PullsView } = await import('@/features/pulls/pulls-view.tsx');

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
  issueIdentifier: 'ENG-12',
  issueTitle: 'Reconnect banner never clears',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PullsView', () => {
  it('links the issue behind each pull request, identifier and title together', () => {
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    const link = screen.getByTestId('pull-issue-ENG-12');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/issue/ENG-12');
    expect(link.textContent).toContain('ENG-12');
    expect(link.textContent).toContain('Reconnect banner never clears');
  });

  it('keeps the pull request itself pointing at the forge', () => {
    render(<PullsView pulls={[pull]} userId="user_1" reach="connected" canManageIntegrations />);

    const row = screen.getByRole('listitem');
    const forge = within(row).getByRole('link', {
      name: 'Buffer the socket until the hub attaches',
    });
    expect(forge).toHaveAttribute('href', 'https://github.com/noveum/orbit/pull/42');
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

  it('says what makes a pull request link once every repository is tracked', () => {
    render(<PullsView pulls={[]} userId="user_1" reach="connected" canManageIntegrations />);

    expect(screen.getByText('No pull requests linked to your issues')).toBeInTheDocument();
    expect(screen.getByText(/branch or title names an issue/)).toBeInTheDocument();
  });

  it('offers the route to integrations even when naming is the only thing left to fix', () => {
    render(<PullsView pulls={[]} userId="user_1" reach="connected" canManageIntegrations />);

    expect(screen.getByTestId('pulls-connect-github')).toHaveAttribute(
      'href',
      '/settings/integrations',
    );
  });

  it('names the untracked repository as well as naming, never one instead of the other', () => {
    render(
      <PullsView pulls={[]} userId="user_1" reach="repositories_untracked" canManageIntegrations />,
    );

    expect(screen.getByText(/has to name an issue/)).toBeInTheDocument();
    expect(screen.getByText(/reports the delivery as accepted/)).toBeInTheDocument();
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

    expect(screen.getByText(/workspace admin picks which ones to track/)).toBeInTheDocument();
    expect(screen.queryByTestId('pulls-connect-github')).not.toBeInTheDocument();
  });

  it('never asserts naming is the only remaining cause while a repository is untracked', () => {
    render(
      <PullsView pulls={[]} userId="user_1" reach="repositories_untracked" canManageIntegrations />,
    );

    expect(
      screen.queryByText(/Copy branch name on an issue gives you one that matches/),
    ).toBeNull();
  });

  it('sends a member who cannot manage integrations to an admin rather than a dead end', () => {
    render(
      <PullsView pulls={[]} userId="user_1" reach="not_installed" canManageIntegrations={false} />,
    );

    expect(screen.getByText(/workspace admin needs to connect GitHub/)).toBeInTheDocument();
    expect(screen.queryByTestId('pulls-connect-github')).not.toBeInTheDocument();
  });
});
