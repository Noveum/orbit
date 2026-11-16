import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { type DocUpdateInput, docUpdateSchema } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { queryKeys } from '@/lib/query/keys.ts';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile([
  '@/features/issues/workspace-provider.tsx',
  'next/navigation',
  '@orbit/realtime-client/react',
]);

const push = mock();

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock() }),
  usePathname: () => '/docs/doc_1',
  useParams: () => ({ id: 'doc_1' }),
}));

const workspace = {
  ready: true,
  userId: 'user_reader',
  teams: [],
  states: [],
  labels: [],
  members: [],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map(),
  labelById: new Map(),
  memberById: new Map(),
  openQuickCreate: () => undefined,
} as unknown as WorkspaceData;

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { DocSurface } = await import('../../../src/features/docs/doc-surface.tsx');

const realFetch = globalThis.fetch;

function detail(revision: number, title: string, content: string) {
  return {
    doc: {
      id: 'doc_1',
      organizationId: 'org_1',
      collectionId: null,
      projectId: null,
      parentId: null,
      title,
      slug: 'shared-doc',
      content,
      revision,
      sortOrder: 0,
      visibility: 'workspace',
      publishToken: null,
      authorId: 'user_author',
      repoBinding: null,
      syncId: revision,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null,
    },
    contentHtml: renderMarkdownWithHeadingIds(content),
    attachments: [],
    author: { id: 'user_author', name: 'Ada', image: null },
    followers: 1,
    backlinks: [],
    access: 'write',
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('loading the other editor version after a stale save', () => {
  it('keeps the draft when the refresh fails and lets the writer retry before adopting fresh content', async () => {
    let reads = 0;
    const writes: DocUpdateInput[] = [];
    const original = detail(1, 'Stored title', 'Original body');
    const latest = detail(9, 'Other editor title', 'Body from the other editor');
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const answer = (payload: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        );
      if (url === '/api/docs/doc_1' && init?.method === 'PATCH') {
        const patch = docUpdateSchema.parse(JSON.parse(String(init.body ?? '{}')));
        writes.push(patch);
        if (writes.length > 1) {
          const { baseRevision: _baseRevision, ...fields } = patch;
          return answer({
            doc: { ...latest.doc, ...fields, revision: 10 },
            contentHtml: latest.contentHtml,
          });
        }
        return answer(
          {
            error: {
              code: 'conflict',
              message: 'The document changed.',
              details: { reason: 'stale_revision', revision: 9 },
            },
          },
          409,
        );
      }
      if (url === '/api/docs/doc_1') {
        reads += 1;
        if (reads === 2) return answer({ error: { code: 'internal', message: 'Offline' } }, 503);
        return answer(reads === 1 ? original : latest);
      }
      if (url.endsWith('/visit')) return answer({ docId: 'doc_1' });
      if (url.startsWith('/api/comments')) return answer({ comments: [] });
      if (url.startsWith('/api/docs')) return answer({ docs: [], collections: [], projects: [] });
      return answer({});
    }) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <TooltipProvider>
            <DocSurface docId="doc_1" canWriteDocs canPublish={false} />
          </TooltipProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const title = await screen.findByTestId('doc-title-input');
    const body = await screen.findByRole('textbox', { name: 'Doc body' });
    fireEvent.change(title, { target: { value: 'My unsaved draft' } });
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });

    await screen.findByTestId('doc-save-conflict');
    await waitFor(() => expect(client.getQueryState(queryKeys.doc('doc_1'))?.status).toBe('error'));
    expect(reads).toBe(2);
    expect(title).toHaveValue('My unsaved draft');
    expect(screen.queryByRole('button', { name: 'Load their version' }) === null).toBe(true);
    const retry = await screen.findByRole('button', { name: 'Retry fetching their version' });
    expect(retry).toBeEnabled();

    await userEvent.click(retry);
    const load = await screen.findByRole('button', { name: 'Load their version' });
    await waitFor(() => expect(load).toBeEnabled());
    expect(reads).toBe(3);
    expect(title).toHaveValue('My unsaved draft');

    await userEvent.click(load);
    await waitFor(() => expect(title).toHaveValue('Other editor title'));
    expect(body).toHaveTextContent('Body from the other editor');
    expect(screen.queryByTestId('doc-save-conflict')).toBeNull();
    fireEvent.change(title, { target: { value: 'Saved after loading' } });
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((patch) => patch.baseRevision)).toEqual([1, 9]);
    view.unmount();
    client.clear();
  });
  it('fetches after the conflict instead of adopting a background read started while saving', async () => {
    const original = detail(1, 'Stored title', 'Original body');
    const latest = detail(9, 'Other editor title', 'Body from the other editor');
    let reads = 0;
    let writes = 0;
    let completeSave: (response: Response) => void = () => undefined;
    const saveResponse = new Promise<Response>((resolve) => {
      completeSave = resolve;
    });
    let completeBackground: (response: Response) => void = () => undefined;
    const backgroundResponse = new Promise<Response>((resolve) => {
      completeBackground = resolve;
    });
    const answer = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/docs/doc_1' && init?.method === 'PATCH') {
        writes += 1;
        return saveResponse;
      }
      if (url === '/api/docs/doc_1') {
        reads += 1;
        if (reads === 2) return backgroundResponse;
        return Promise.resolve(answer(reads === 1 ? original : latest));
      }
      if (url.endsWith('/visit')) return Promise.resolve(answer({ docId: 'doc_1' }));
      if (url.startsWith('/api/comments')) return Promise.resolve(answer({ comments: [] }));
      if (url.startsWith('/api/docs')) {
        return Promise.resolve(answer({ docs: [], collections: [], projects: [] }));
      }
      return Promise.resolve(answer({}));
    }) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <TooltipProvider>
            <DocSurface docId="doc_1" canWriteDocs canPublish={false} />
          </TooltipProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const title = await screen.findByTestId('doc-title-input');
    const body = await screen.findByRole('textbox', { name: 'Doc body' });
    fireEvent.change(title, { target: { value: 'My unsaved draft' } });
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(writes).toBe(1));
    const background = client.refetchQueries({ queryKey: queryKeys.doc('doc_1'), exact: true });
    await waitFor(() => expect(reads).toBe(2));
    completeSave(
      answer(
        {
          error: {
            code: 'conflict',
            message: 'The document changed.',
            details: { reason: 'stale_revision', revision: 9 },
          },
        },
        409,
      ),
    );
    await screen.findByTestId('doc-save-conflict');
    completeBackground(answer(original));
    await background;
    const load = await screen.findByRole('button', { name: 'Load their version' });
    await userEvent.click(load);
    await waitFor(() => expect(title).toHaveValue('Other editor title'));
    expect(body).toHaveTextContent('Body from the other editor');
    expect(reads).toBe(3);
    view.unmount();
    client.clear();
  });
});
