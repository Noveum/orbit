import { expect, it, spyOn } from 'bun:test';
import type { GithubRecoveryCandidate } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GithubCheckRecovery } from '@/features/settings/github-check-recovery.tsx';

const candidate: GithubRecoveryCandidate = {
  repositoryName: 'orbit/example',
  pullRequestNumber: 11,
  selector: {
    reconciliationId: 'head-11',
    pullRequestId: 'pull-11',
    expectedHeadSha: 'a'.repeat(40),
    expectedHeadEpoch: 2,
    expectedContextGeneration: 3,
    expectedJobVersion: 4,
  },
};

it.each([
  ['queued', 'Retry queued.'],
  ['superseded', 'The saved check changed.'],
  ['busy', 'A check update is already in progress.'],
  ['installation_unavailable', 'GitHub could not find this installation.'],
])('posts only the selected GitHub check after a click and reports %s', async (status, message) => {
  const client = new QueryClient();
  const requests: { url: string; method?: string | undefined; body: unknown }[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (...[input, init]: Parameters<typeof fetch>) => {
        requests.push({
          url: String(input),
          method: init?.method,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const other = {
          ...candidate,
          pullRequestNumber: 12,
          selector: {
            ...candidate.selector,
            pullRequestId: 'pull-12',
            reconciliationId: candidate.selector.reconciliationId,
          },
        };
        return Promise.resolve(
          Response.json(
            init?.method === 'POST'
              ? { status }
              : { workspace: 'org-one', candidates: [other, candidate], nextCursor: null },
          ),
        );
      },
      { preconnect: () => undefined },
    ),
  );
  try {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <GithubCheckRecovery organizationId="org-one" userId="one" />
      </QueryClientProvider>,
    );
    const retry = await screen.findByRole('button', {
      name: 'Retry check updates for orbit/example#11',
    });
    expect(requests.map((r) => r.method)).toEqual(['GET']);
    await user.click(retry);
    expect(await screen.findByRole('status')).toHaveTextContent(message);
    expect(requests.filter((r) => r.method === 'POST')).toEqual([
      { url: '/api/integrations/github/check-recovery', method: 'POST', body: candidate.selector },
    ]);
  } finally {
    fetchSpy.mockRestore();
    client.clear();
  }
});
it('pages through check updates and clears cached rows when the active workspace changes', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  const requests: string[] = [];
  let activeWorkspace = 'org-one';
  const nextCursor = { workspace: activeWorkspace, after: candidate.selector.pullRequestId };
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost');
        requests.push(url.search);
        if (activeWorkspace === 'org-two')
          return Promise.resolve(
            Response.json({ workspace: activeWorkspace, candidates: [], nextCursor: null }),
          );
        if (!url.search)
          return Promise.resolve(
            Response.json({ workspace: 'org-one', candidates: [candidate], nextCursor }),
          );
        expect(Object.fromEntries(url.searchParams)).toEqual(nextCursor);
        return Promise.resolve(
          Response.json({
            workspace: activeWorkspace,
            candidates: [
              {
                ...candidate,
                pullRequestNumber: 21,
                selector: { ...candidate.selector, pullRequestId: 'pull-21' },
              },
            ],
            nextCursor: null,
          }),
        );
      },
      { preconnect: () => undefined },
    ),
  );
  const page = () => (
    <QueryClientProvider client={client}>
      <GithubCheckRecovery key={activeWorkspace} organizationId={activeWorkspace} userId="one" />
    </QueryClientProvider>
  );
  try {
    const user = userEvent.setup();
    const view = render(page());
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(
      await screen.findByRole('button', { name: 'Retry check updates for orbit/example#21' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(
      await screen.findByRole('button', { name: 'Retry check updates for orbit/example#11' }),
    ).toBeEnabled();
    activeWorkspace = 'org-two';
    view.rerender(page());
    expect(
      screen.queryByRole('button', { name: 'Retry check updates for orbit/example#11' }),
    ).toBeNull();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('region', { name: 'Failed GitHub check updates' })).toBeNull();
    expect(requests).toHaveLength(3);
    activeWorkspace = 'org-three';
    view.rerender(page());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load failed GitHub check updates.',
    );
    expect(
      screen.queryByRole('button', { name: 'Retry check updates for orbit/example#11' }),
    ).toBeNull();
  } finally {
    fetchSpy.mockRestore();
    client.clear();
  }
});
