import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SavedAnalyticsViewPayload } from '@orbit/core';
import { analyticsQuerySchema, insightConfigSchema } from '@orbit/shared/validators';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../../src/components/ui/toast.tsx';
import { SavedViewBar } from '../../../src/features/analytics/saved-view-bar.tsx';
import { createQueryClient } from '../../../src/lib/query/provider.tsx';

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
  sent = [];
  respondWith(200, {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function Wrapper({ children }: { readonly children: ReactNode }) {
  const client = createQueryClient();
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const asOf = '2026-08-15T00:00:00.000Z';

describe('SavedViewBar', () => {
  it('includes the current insight config in the saved payload when the lens is insights', async () => {
    const user = userEvent.setup();
    const query = analyticsQuerySchema.parse({ lens: 'insights' });
    const insight = insightConfigSchema.parse({
      measure: 'points',
      slice: 'assignee',
      segment: 'state',
    });
    respondWith(200, {
      view: {
        id: 'view_1',
        name: 'Points by assignee',
        scopeType: 'workspace',
        scopeId: null,
        kind: 'dashboard',
        config: { kind: 'dashboard', version: 1, query, insight, pinned: false },
        shared: false,
        ownerId: 'user_1',
        createdAt: asOf,
        updatedAt: asOf,
      },
    });

    render(
      <SavedViewBar
        canManage
        canManageAll={false}
        currentUserId="user_1"
        insight={insight}
        onApply={mock()}
        query={query}
        views={[]}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole('button', { name: 'Save view' }));
    await user.type(screen.getByLabelText('Analytics view name'), 'Points by assignee');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body['config']).toMatchObject({ insight });
  });

  it('leaves a non-insights save without an insight key, byte-identical to before', async () => {
    const user = userEvent.setup();
    const query = analyticsQuerySchema.parse({ lens: 'overview' });
    const defaultInsight = insightConfigSchema.parse({});
    respondWith(200, {
      view: {
        id: 'view_2',
        name: 'Q3',
        scopeType: 'workspace',
        scopeId: null,
        kind: 'dashboard',
        config: { kind: 'dashboard', version: 1, query, pinned: false },
        shared: false,
        ownerId: 'user_1',
        createdAt: asOf,
        updatedAt: asOf,
      },
    });

    render(
      <SavedViewBar
        canManage
        canManageAll={false}
        currentUserId="user_1"
        insight={defaultInsight}
        onApply={mock()}
        query={query}
        views={[]}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole('button', { name: 'Save view' }));
    await user.type(screen.getByLabelText('Analytics view name'), 'Q3');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body['config']).toEqual({
      kind: 'dashboard',
      version: 1,
      query,
      pinned: false,
    });
  });

  it('applies a saved view together with its stored insight config', async () => {
    const user = userEvent.setup();
    const query = analyticsQuerySchema.parse({ lens: 'insights' });
    const savedInsight = insightConfigSchema.parse({
      measure: 'points',
      slice: 'assignee',
      segment: 'state',
    });
    const onApply = mock();
    const view: SavedAnalyticsViewPayload = {
      id: 'view_3',
      name: 'Points by assignee',
      scopeType: 'workspace',
      scopeId: null,
      kind: 'dashboard',
      config: { kind: 'dashboard', version: 1, query, insight: savedInsight, pinned: false },
      shared: false,
      ownerId: 'user_1',
      createdAt: asOf,
      updatedAt: asOf,
    };

    render(
      <SavedViewBar
        canManage={false}
        canManageAll={false}
        currentUserId="user_1"
        insight={insightConfigSchema.parse({})}
        onApply={onApply}
        query={analyticsQuerySchema.parse({})}
        views={[view]}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole('button', { name: 'Points by assignee' }));

    expect(onApply).toHaveBeenCalledWith(query, savedInsight);
  });
});
