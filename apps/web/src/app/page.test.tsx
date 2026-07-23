import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';

const sessionHolder: { value: { user: { id: string } } | null } = { value: null };

mock.module('@/lib/auth/session.ts', () => ({
  getSession: () => Promise.resolve(sessionHolder.value),
  requireSession: () => Promise.resolve(sessionHolder.value),
}));

mock.module('next/navigation', () => ({
  ...navigation,
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  useRouter: () => ({ push: mock() }),
}));

const { default: HomePage } = await import('./page.tsx');

describe('HomePage', () => {
  beforeEach(() => {
    sessionHolder.value = null;
  });

  it('renders the landing hero for a logged-out visitor', async () => {
    render(await HomePage());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Issue tracking at the speed of typing.',
    );
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('redirects a logged-in visitor to their issues', async () => {
    sessionHolder.value = { user: { id: 'user-1' } };
    await expect(HomePage()).rejects.toThrow('redirect:/my-issues');
  });
});
