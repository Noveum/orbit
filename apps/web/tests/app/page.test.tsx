import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';
import { HOSTED_ACCESS_NOTICE } from '../../src/lib/auth/oauth-error.ts';
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
const previousAppUrl = process.env['NEXT_PUBLIC_APP_URL'];

describe('HomePage', () => {
  beforeEach(() => {
    sessionHolder.value = null;
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://orbit.noveum.ai';
  });

  afterAll(() => {
    if (previousAppUrl === undefined) {
      delete process.env['NEXT_PUBLIC_APP_URL'];
    } else {
      process.env['NEXT_PUBLIC_APP_URL'] = previousAppUrl;
    }
  });

  it('renders the landing hero for a logged-out visitor', async () => {
    render(await HomePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Issue tracking at the speed of typing.',
    );
    expect(screen.getByText(HOSTED_ACCESS_NOTICE)).toBeDefined();
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('redirects a logged-in visitor to their issues', async () => {
    sessionHolder.value = { user: { id: 'user-1' } };
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/my-issues',
    );
  });
});
