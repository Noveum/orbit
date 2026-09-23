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
    expect(
      screen.getByRole('heading', { name: 'Where to configure your deployment' }),
    ).toBeVisible();
    expect(screen.getByText(/This page cannot save server credentials yet/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Slack setup' })).toHaveAttribute('href', '#slack');
    expect(document.getElementById('slack')).not.toBeNull();
    expect(screen.getByText('Set up the Slack app')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Refresh configuration status' })).toHaveAttribute(
      'href',
      '/settings/deployment',
    );
  });

  it('renders variable presence without disclosing environment values', async () => {
    const previous = process.env['SLACK_CLIENT_SECRET'];
    process.env['SLACK_CLIENT_SECRET'] = 'do-not-render-existing-secret';
    try {
      role = 'admin';
      const { container } = render(await DeploymentSettingsPage());
      expect(container.textContent).toContain('SLACK_CLIENT_SECRET');
      expect(container.textContent).toContain('Set in environment');
      expect(container.innerHTML).not.toContain('do-not-render-existing-secret');
    } finally {
      if (previous === undefined) delete process.env['SLACK_CLIENT_SECRET'];
      else process.env['SLACK_CLIENT_SECRET'] = previous;
    }
  });

  it.each(['member', 'contributor', 'guest'] as const)(
    'returns the not-found boundary instead of a server error for %s',
    async (value) => {
      role = value;
      await expect(DeploymentSettingsPage()).rejects.toBe(missing);
    },
  );
});
