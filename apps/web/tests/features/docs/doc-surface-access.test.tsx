import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { createQueryClient } from '@/lib/query/provider.tsx';

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

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: () => undefined }),
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

const MARKDOWN = '# Delta protocol\n\nEvery mutation bumps sync_id.';

interface RequestLog {
  readonly method: string;
  readonly url: string;
}

let requests: RequestLog[] = [];
const realFetch = globalThis.fetch;

function docPayload(access: 'read' | 'write', archivedAt: string | null) {
  return {
    doc: {
      id: 'doc_1',
      organizationId: 'org_1',
      collectionId: null,
      projectId: null,
      parentId: null,
      title: 'Delta protocol',
      slug: 'delta-protocol',
      content: MARKDOWN,
      visibility: 'private',
      publishToken: null,
      authorId: 'user_author',
      repoBinding: null,
      syncId: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt,
    },
    contentHtml: renderMarkdownWithHeadingIds(MARKDOWN),
    attachments: [],
    author: { id: 'user_author', name: 'Ada', image: null },
    followers: 1,
    backlinks: [],
    access,
  };
}

function stubFetch(access: 'read' | 'write', archivedAt: string | null): void {
  globalThis.fetch = mock((input: string, init?: { method?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url });

    const body = (payload: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });

    if (url.endsWith('/duplicate'))
      return body({ doc: { ...docPayload('write', null).doc, id: 'doc_copy' } });
    if (url.startsWith('/api/docs/doc_1')) return body(docPayload(access, archivedAt));
    if (url.startsWith('/api/docs')) return body({ docs: [], collections: [], projects: [] });
    if (url.startsWith('/api/comments')) return body({ comments: [] });
    return body({});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requests = [];
  push.mockClear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function renderSurface(options: {
  access: 'read' | 'write';
  canWriteDocs?: boolean;
  archivedAt?: string | null;
}) {
  stubFetch(options.access, options.archivedAt ?? null);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <DocSurface docId="doc_1" canWriteDocs={options.canWriteDocs ?? true} canPublish={false} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Export doc');
}

describe('the doc surface follows the per doc access level, not the workspace role', () => {
  it('gives a member with a read grant the reader and no editable title', async () => {
    await renderSurface({ access: 'read' });

    expect(await screen.findByTestId('doc-reader')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-title-input')).toBeNull();
    expect(screen.queryByTestId('doc-save-status')).toBeNull();
    expect(screen.getByTestId('doc-read-only').textContent).toBe('Read only');
  });

  it('gives a member with a write grant the editor', async () => {
    await renderSurface({ access: 'write' });

    expect(await screen.findByTestId('doc-title-input')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-reader')).toBeNull();
    expect(screen.queryByTestId('doc-read-only')).toBeNull();
    expect(screen.getByTestId('doc-save-status')).toBeInTheDocument();
  });

  it('never offers the editor for an archived doc, whatever the grant says', async () => {
    await renderSurface({ access: 'write', archivedAt: '2026-02-01T00:00:00.000Z' });

    expect(await screen.findByTestId('doc-reader')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-title-input')).toBeNull();
    expect(screen.getByTestId('doc-read-only').textContent).toBe('Archived');
  });

  it('hides the archive and nest controls from a reader but keeps export', async () => {
    await renderSurface({ access: 'read' });

    expect(screen.queryByTestId('doc-archive')).toBeNull();
    expect(screen.queryByTestId('doc-parent')).toBeNull();
    expect(screen.getByLabelText('Export doc')).toBeInTheDocument();
  });
});

describe('duplicating a doc from the header', () => {
  it('lets a reader take their own copy and opens it', async () => {
    const user = userEvent.setup();
    await renderSurface({ access: 'read' });

    await user.click(await screen.findByTestId('doc-duplicate'));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/docs/doc_copy'));
    expect(requests).toContainEqual({ method: 'POST', url: '/api/docs/doc_1/duplicate' });
  });

  it('never offers the copy to someone who cannot write docs at all', async () => {
    await renderSurface({ access: 'read', canWriteDocs: false });

    expect(await screen.findByTestId('doc-reader')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-duplicate')).toBeNull();
    expect(screen.queryByTestId('doc-read-only')).toBeNull();
  });
});
