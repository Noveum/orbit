import { afterAll, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';

const handlerModule = { ...(await import('@/lib/api/handler.ts')) };
const navigationModule = { ...(await import('next/navigation')) };
const mcpDataModule = { ...(await import('@/features/settings/mcp-data.ts')) };

mock.module('@/lib/api/handler.ts', () => ({
  ...handlerModule,
  pageContext: () =>
    Promise.resolve({
      principal: { userId: 'user', organizationId: 'org', role: 'member', teamIds: [] },
    }),
}));
mock.module('next/navigation', () => ({
  ...navigationModule,
  useRouter: () => ({ refresh: () => undefined }),
}));
mock.module('@/features/settings/mcp-data.ts', () => ({
  loadMcpConnections: () => Promise.resolve([]),
}));

const { default: McpSettingsPage } = await import('@/app/(app)/settings/mcp/page.tsx');

afterAll(() => {
  mock.module('@/lib/api/handler.ts', () => handlerModule);
  mock.module('next/navigation', () => navigationModule);
  mock.module('@/features/settings/mcp-data.ts', () => mcpDataModule);
});

describe('McpSettingsPage', () => {
  it('shows the server URL and the starter prompts that onboarding points people to', async () => {
    render(await McpSettingsPage());
    expect(screen.getByTestId('mcp-url')).toHaveTextContent(/\/mcp$/);
    expect(screen.getByRole('heading', { name: 'Starter prompts' })).toBeVisible();
    expect(screen.getByTestId('starter-prompt-picker')).toBeVisible();
  });
});
