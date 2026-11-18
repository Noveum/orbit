import { expect, it, spyOn } from 'bun:test';
import type { GithubRecoveryCandidate } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
            reconciliationId: 'head-12',
          },
        };
        return Promise.resolve(
          Response.json(init?.method === 'POST' ? { status } : [other, candidate]),
        );
      },
      { preconnect: () => undefined },
    ),
  );
  try {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <GithubCheckRecovery organizationId="org-one" />
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
