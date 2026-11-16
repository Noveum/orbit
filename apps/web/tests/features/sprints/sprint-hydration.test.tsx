import { expect, mock, test } from 'bun:test';
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { defaultViewConfig } from '@/features/filters/view-config.ts';
import { SprintIssues } from '@/features/sprints/sprint-issues.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { cycleIssuesSearch } from '@/lib/query/issue-search.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { createQueryClient } from '@/lib/query/provider.tsx';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['next/navigation']);

mock.module('next/navigation', () => ({
  usePathname: () => '/sprints',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

test('hydrates a sprint without replacing its server markup when the client cache is warm', async () => {
  const client = createQueryClient();
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = Object.assign(
    mock(() => new Promise<Response>(() => undefined)),
    fetchBefore,
  );
  const container = document.createElement('div');
  document.body.append(container);
  function Providers({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <HotkeyProvider>{children}</HotkeyProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  const content = (
    <Providers>
      <SprintIssues cycleId="cycle-1" sprintName="Sprint 1" layout="board" />
    </Providers>
  );
  container.innerHTML = renderToString(content);
  expect(container.querySelector('[data-testid="list-skeleton"]')).not.toBeNull();
  const config = defaultViewConfig('board');
  const search = cycleIssuesSearch('cycle-1', { filter: config.filter, orderBy: config.orderBy });
  client.setQueryData(queryKeys.cycleIssues('cycle-1', search), {
    pages: [{ issues: [], nextCursor: null }],
    pageParams: [null],
  });
  const errors: unknown[] = [];
  const root = hydrateRoot(container, content, {
    onRecoverableError: (error) => errors.push(error),
  });
  try {
    await act(async () => undefined);
    expect(container.textContent).toContain('Nothing in this sprint yet');
    expect(errors).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    globalThis.fetch = fetchBefore;
  }
});
