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
    render(<PullsView pulls={[pull]} userId="user_1" />);

    const link = screen.getByTestId('pull-issue-ENG-12');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/issue/ENG-12');
    expect(link.textContent).toContain('ENG-12');
    expect(link.textContent).toContain('Reconnect banner never clears');
  });

  it('keeps the pull request itself pointing at the forge', () => {
    render(<PullsView pulls={[pull]} userId="user_1" />);

    const row = screen.getByRole('listitem');
    const forge = within(row).getByRole('link', {
      name: 'Buffer the socket until the hub attaches',
    });
    expect(forge).toHaveAttribute('href', 'https://github.com/noveum/orbit/pull/42');
  });
});
