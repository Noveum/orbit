import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { previewDetail, usePrefetchIssueDetail } from '@/lib/query/use-issues.ts';
import { IssueCard } from './issue-card.tsx';
import { IssueRow } from './issue-row.tsx';

function issue(): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 420,
    identifier: 'ENG-420',
    title: 'Ship the sync engine',
    description: 'A body the board already knows about.',
    stateId: 'state_todo',
    priority: 2,
    assigneeId: null,
    creatorId: 'user_1',
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    sortOrder: 0.5,
    labelIds: [],
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    dueDate: null,
  } as unknown as Issue;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe('opening an issue the list already holds', () => {
  it('carries the row into the detail shape so the panel has something to paint', () => {
    const preview = previewDetail(issue());

    expect(preview.issue.title).toBe('Ship the sync engine');
    expect(preview.issue.description).toBe('A body the board already knows about.');
    expect(preview.activity).toEqual([]);
    expect(preview.subIssues).toEqual([]);
    expect(preview.subscribed).toBe(false);
    expect(preview.descriptionHtml).toBe('');
  });

  it('warms the detail cache on hover so the click does not wait on the network', async () => {
    const asked: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      asked.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            issue: issue(),
            descriptionHtml: '<p>Rendered</p>',
            activity: [],
            activityCursor: null,
            subIssues: [],
            subscribed: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Hoverable() {
      const prefetch = usePrefetchIssueDetail();
      return (
        <button type="button" onPointerEnter={() => prefetch('ENG-420')}>
          ENG-420
        </button>
      );
    }

    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Hoverable />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(asked).toEqual([]);

    await userEvent.hover(screen.getByRole('button', { name: 'ENG-420' }));

    await waitFor(() => expect(asked).toEqual(['/api/issues/ENG-420']));
    await waitFor(() => expect(client.getQueryState(['issue', 'ENG-420'])?.status).toBe('success'));
  });
});

describe('warming a card the pointer is dragging', () => {
  function warmed(): { asked: string[]; client: QueryClient } {
    const asked: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      asked.push(String(input));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    return { asked, client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
  }

  function wrap(node: ReactElement, client: QueryClient) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{node}</ToastProvider>
      </QueryClientProvider>
    );
  }

  it('warms from a board card on hover, and holds off while it is being dragged', async () => {
    const { asked, client } = warmed();
    render(wrap(<IssueCard issue={issue()} labels={[]} assignee={undefined} />, client));

    const card = screen.getByTestId('issue-card-ENG-420');
    fireEvent.pointerEnter(card, { buttons: 1 });
    await waitFor(() => expect(asked).toEqual([]));

    fireEvent.pointerEnter(card, { buttons: 0 });
    await waitFor(() => expect(asked).toEqual(['/api/issues/ENG-420']));
  });

  it('warms from a list row the same way', async () => {
    const { asked, client } = warmed();
    render(
      wrap(
        <IssueRow
          issue={issue()}
          state={undefined}
          labels={[]}
          assignee={undefined}
          active={false}
          selected={false}
          onOpen={() => undefined}
          onToggleSelected={() => undefined}
          onFocus={() => undefined}
        />,
        client,
      ),
    );

    const row = screen.getByTestId('issue-row-ENG-420');
    fireEvent.pointerEnter(row, { buttons: 1 });
    await waitFor(() => expect(asked).toEqual([]));

    fireEvent.pointerEnter(row, { buttons: 0 });
    await waitFor(() => expect(asked).toEqual(['/api/issues/ENG-420']));
  });
});
