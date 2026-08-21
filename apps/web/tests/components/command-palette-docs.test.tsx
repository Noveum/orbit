import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import userEvent from '@testing-library/user-event';
import * as nextThemes from 'next-themes';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { buildNavigation } from '@/lib/navigation.ts';
import type { DocSummary } from '@/lib/query/schemas.ts';
import { fireEvent, render, screen } from '@/test/render.tsx';

const push = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/inbox',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

mock.module('next-themes', () => ({
  ...nextThemes,
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: mock() }),
}));

function doc(id: string, title: string, snippet: string): DocSummary {
  return {
    id,
    organizationId: 'org_1',
    collectionId: null,
    projectId: null,
    parentId: null,
    title,
    slug: id,
    kind: 'markdown',
    content: '',
    sortOrder: 0,
    visibility: 'workspace',
    publishToken: null,
    authorId: 'user_1',
    repoBinding: null,
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    excerpt: '',
    snippet,
    titleMatch: snippet.length === 0,
    rank: 0,
  };
}

const results: readonly DocSummary[] = [
  doc('doc_titled', 'Presence protocol', ''),
  doc('doc_body', 'Deploy runbook', '…step four checks presence before the cutover.'),
];

const realFetch = globalThis.fetch;
let asked: string[] = [];

function stubApi(): void {
  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const payload = url.startsWith('/api/docs')
      ? { docs: results, collections: [], projects: [] }
      : { issues: [] };
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
}

const { CommandPalette } = await import('@/components/command-palette.tsx');

const sections = buildNavigation([{ id: 'team_1', key: 'ENG', name: 'Engineering' }]);

function renderPalette(open = true) {
  render(
    <HotkeyProvider>
      <CommandPalette
        open={open}
        onOpenChange={mock()}
        sections={sections}
        onToggleSidebar={() => undefined}
        onShowShortcuts={() => undefined}
      />
    </HotkeyProvider>,
  );
}

async function search(term: string) {
  await userEvent.setup().type(await screen.findByPlaceholderText(/Search issues/), term);
}

function hit(testId: string): Promise<HTMLElement> {
  return screen.findByTestId(testId, {}, { timeout: 5000 });
}

beforeEach(() => {
  push.mockClear();
  asked = [];
  stubApi();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('command palette doc results', () => {
  it('finds a doc from anywhere, not only inside /docs', async () => {
    renderPalette();
    await search('presence');

    expect(await hit('palette-doc-doc_titled')).toBeTruthy();
    expect(screen.getByTestId('palette-doc-doc_body')).toBeTruthy();
    expect(asked.some((url) => url.startsWith('/api/docs?'))).toBe(true);
  });

  it('opens the doc it was told to open', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPalette();
    await search('presence');

    await user.click(await hit('palette-doc-doc_body'));

    expect(push).toHaveBeenCalledWith('/docs/doc_body');
  });

  it('shows why a body-only hit matched, with the term marked', async () => {
    renderPalette();
    await search('presence');

    const snippet = await hit('palette-doc-snippet-doc_body');
    expect(snippet.textContent).toContain('checks presence before the cutover');
    expect([...snippet.querySelectorAll('mark')].map((node) => node.textContent)).toEqual([
      'presence',
    ]);
  });

  it('shows no passage under a title-only hit', async () => {
    renderPalette();
    await search('presence');

    await hit('palette-doc-doc_titled');
    expect(screen.queryByTestId('palette-doc-snippet-doc_titled')).toBeNull();
  });

  it('reaches each hit as a real link, out of the tab order', async () => {
    renderPalette();
    await search('presence');

    const link = (await hit('palette-doc-doc_body')).querySelector('a');
    expect(link?.getAttribute('href')).toBe('/docs/doc_body');
    expect(link?.getAttribute('tabindex')).toBe('-1');
  });

  it('lets a modified click open the doc in a new tab without routing this one', async () => {
    renderPalette();
    await search('presence');

    const link = (await hit('palette-doc-doc_body')).querySelector('a');
    expect(link).not.toBeNull();
    if (link === null) return;

    fireEvent.click(link, { metaKey: true });
    expect(push).not.toHaveBeenCalled();
  });

  it('asks for nothing while the palette is shut', () => {
    renderPalette(false);

    expect(asked.filter((url) => url.startsWith('/api/docs'))).toEqual([]);
    expect(screen.queryByTestId('palette-doc-doc_body')).toBeNull();
  });
});
