import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { Principal } from '@orbit/shared/policy';
import { render, screen } from '@testing-library/react';

const handlerModule = { ...(await import('@/lib/api/handler.ts')) };
const navigationModule = { ...(await import('next/navigation')) };
let role: Principal['role'] = 'admin';
const missing = new Error('NEXT_HTTP_ERROR_FALLBACK;404');

mock.module('@/lib/api/handler.ts', () => ({
  ...handlerModule,
  pageContext: () =>
    Promise.resolve({ principal: { userId: 'user', organizationId: 'org', role, teamIds: [] } }),
}));
mock.module('next/navigation', () => ({
  ...navigationModule,
  notFound: () => {
    throw missing;
  },
}));

const { default: DeploymentSettingsPage } = await import(
  '@/app/(app)/settings/deployment/page.tsx'
);

afterAll(() => {
  mock.module('@/lib/api/handler.ts', () => handlerModule);
  mock.module('next/navigation', () => navigationModule);
});

describe('DeploymentSettingsPage', () => {
  it('shows deployment configuration to workspace admins', async () => {
    role = 'admin';
    render(await DeploymentSettingsPage());
    expect(screen.getByRole('heading', { name: 'Deployment setup' })).toBeVisible();
  });

  it.each(['member', 'contributor', 'guest'] as const)(
    'returns the not-found boundary instead of a server error for %s',
    async (value) => {
      role = value;
      await expect(DeploymentSettingsPage()).rejects.toBe(missing);
    },
  );
});
