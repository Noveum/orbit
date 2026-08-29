import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';
import { mockSession } from '../../tests-support.ts';

const sessionHolder: { value: { user: { id: string } } | null } = { value: null };

mockSession(() => sessionHolder.value);

mock.module('next/navigation', () => ({
  ...navigation,
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  useRouter: () => ({ push: mock() }),
}));

const { default: HomePage } = await import('../../src/app/page.tsx');

describe('HomePage', () => {
  beforeEach(() => {
    sessionHolder.value = null;
  });

  it('renders the landing hero for a logged-out visitor', async () => {
    render(await HomePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Issue tracking at the speed of typing.',
    );
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('tells a visitor that signing up is open to anyone', async () => {
    render(await HomePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/anyone can sign up, free/i)).toBeDefined();
    expect(screen.getByText(/no invite needed/i)).toBeDefined();
  });

  it('promises nobody a signup the allowlist would refuse', async () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'noveum.ai';
    try {
      render(await HomePage({ searchParams: Promise.resolve({}) }));
      expect(screen.queryAllByText(/anyone can sign up, free/i).length).toBe(0);
      expect(screen.queryAllByText(/no invite needed/i).length).toBe(0);
    } finally {
      process.env['ALLOWED_EMAIL_DOMAINS'] = '';
    }
  });

  it('redirects a logged-in visitor to their issues', async () => {
    sessionHolder.value = { user: { id: 'user-1' } };
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/my-issues',
    );
  });
});
