import { afterEach, describe, expect, mock, test } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { AnalyticsDrilldownDialog } from '../../../src/features/analytics/analytics-drilldown-dialog.tsx';
import { render, screen, waitFor } from '../../../src/test/render.tsx';

const originalFetch = globalThis.fetch;
const query = analyticsQuerySchema.parse({});

function page(nextCursor: string | null, identifier: string) {
  return {
    predicate: 'completed',
    total: 2,
    totalValue: 2,
    details: { validCycleCount: 1, cycleTimeP50: 2, cycleTimeP85: 2 },
    issues: [
      {
        id: `00000000-0000-7000-8000-${identifier === 'ORB-1' ? '000000000001' : '000000000002'}`,
        identifier,
        title: identifier === 'ORB-1' ? 'Ship analytics' : 'Fix sprint burn',
        priority: 2,
        estimate: 3,
        dueDate: null,
        updatedAt: '2026-08-13T12:00:00.000Z',
        completedAt: '2026-08-13T11:00:00.000Z',
        cycleTimeDays: 2,
        state: {
          id: '00000000-0000-7000-8000-000000000003',
          name: 'Done',
          category: 'completed',
        },
        project: null,
        assignee: null,
      },
      ...(nextCursor === null
        ? []
        : [
            {
              id: '00000000-0000-7000-8000-000000000003',
              identifier: 'ORB-3',
              title: 'Earlier evidence',
              priority: 1,
              estimate: 1,
              dueDate: null,
              updatedAt: '2026-08-12T12:00:00.000Z',
              completedAt: null,
              cycleTimeDays: null,
              state: {
                id: '00000000-0000-7000-8000-000000000004',
                name: 'Todo',
                category: 'unstarted',
              },
              project: null,
              assignee: null,
            },
          ]),
    ],
    nextCursor,
    limit: 1,
    asOf: '2026-08-13T12:00:00.000Z',
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-14T00:00:00.000Z',
    timezone: 'UTC',
  };
}

function Harness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button onClick={() => setOpen(true)} ref={triggerRef} type="button">
        Completed work
      </button>
      <AnalyticsDrilldownDialog
        cohort={{ cohort: 'completed', bucket: '2026-08-13' }}
        onOpenChange={setOpen}
        open={open}
        query={query}
        returnFocusRef={triggerRef}
        title="Completed work"
      />
    </>
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('AnalyticsDrilldownDialog', () => {
  test('loads signed sortable evidence pages with context and restores focus', async () => {
    const requests: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      const payload = url.includes('cursor=next') ? page(null, 'ORB-2') : page('next', 'ORB-1');
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Completed work' });
    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Completed work' })).toBeVisible();
    expect(await screen.findByText('Ship analytics')).toBeVisible();
    expect(screen.getByText(/Predicate: completed/)).toBeVisible();
    expect(screen.getByText(/Data through Aug 13, 2026/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Export CSV' })).not.toBeInTheDocument();

    const evidence = screen.getByRole('table', { name: 'Completed work evidence' });
    expect(evidence.querySelector('tbody tr')?.textContent).toContain('ORB-1');
    await user.click(screen.getByRole('button', { name: 'Updated' }));
    expect(evidence.querySelector('tbody tr')?.textContent).toContain('ORB-3');

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Fix sprint burn')).toBeVisible();
    expect(requests.some((request) => request.includes('cursor=next'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
