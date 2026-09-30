import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';
import { render, screen } from '@/test/render.tsx';

const handlerModule = { ...(await import('@/lib/api/handler.ts')) };
const prefetchModule = { ...(await import('@/lib/query/prefetch.ts')) };
const hintModule = { ...(await import('@/features/ai-connect/load-ai-connect-hint.ts')) };
const viewModule = { ...(await import('@/features/issues/my-issues-view.tsx')) };
const navigationModule = { ...(await import('next/navigation')) };

let hintVisible = true;
const hintAskedFor: string[] = [];

mock.module('@/lib/api/handler.ts', () => ({
  ...handlerModule,
  pageContext: () =>
    Promise.resolve({
      principal: { userId: 'user-1', organizationId: 'org', role: 'member', teamIds: [] },
    }),
}));
mock.module('@/lib/query/prefetch.ts', () => ({
  ...prefetchModule,
  dehydratedAssignedIssues: () => Promise.resolve({ mutations: [], queries: [] }),
}));
mock.module('@/features/ai-connect/load-ai-connect-hint.ts', () => ({
  aiConnectHintVisible: (userId: string) => {
    hintAskedFor.push(userId);
    return Promise.resolve(hintVisible);
  },
}));
mock.module('@/features/issues/my-issues-view.tsx', () => ({
  ...viewModule,
  MyIssuesView: ({ banner }: { banner?: ReactNode }) => <div data-testid="my-issues">{banner}</div>,
}));
mock.module('next/navigation', () => ({
  ...navigationModule,
  useRouter: () => ({ refresh: () => undefined }),
}));

const { default: MyIssuesPage } = await import('@/app/(app)/my-issues/page.tsx');

afterAll(() => {
  mock.module('@/lib/api/handler.ts', () => handlerModule);
  mock.module('@/lib/query/prefetch.ts', () => prefetchModule);
  mock.module('@/features/ai-connect/load-ai-connect-hint.ts', () => hintModule);
  mock.module('@/features/issues/my-issues-view.tsx', () => viewModule);
  mock.module('next/navigation', () => navigationModule);
});

describe('MyIssuesPage', () => {
  it('shows the AI connect banner, with the MCP URL, when the hint applies to the viewer', async () => {
    hintVisible = true;
    render(await MyIssuesPage());
    expect(hintAskedFor.at(-1)).toBe('user-1');
    expect(screen.getByTestId('ai-connect-banner')).toBeVisible();
    expect(screen.getByTestId('ai-connect-banner-url')).toHaveTextContent(/\/mcp$/);
  });

  it('leaves the banner out when the hint does not apply', async () => {
    hintVisible = false;
    render(await MyIssuesPage());
    expect(screen.getByTestId('my-issues')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-connect-banner')).toBeNull();
  });
});
