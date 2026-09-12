import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { db, inArray, schema } from '@orbit/db';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { APIError } from 'better-auth/api';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { auth } from '@/lib/auth/server.ts';

const nextHeaders = { ...(await import('next/headers')) };
const nextNavigation = { ...(await import('next/navigation')) };
const authClientModule = { ...(await import('@/lib/auth/client.ts')) };
const authServerModule = { ...(await import('@/lib/auth/server.ts')) };
const toastModule = { ...(await import('@/components/ui/toast.tsx')) };
const userIds: string[] = [];
let requestHeaders = new Headers();

beforeEach(() => {
  mock.module('next/headers', () => ({
    ...nextHeaders,
    headers: () => Promise.resolve(requestHeaders),
  }));
  mock.module('next/navigation', () => ({
    ...nextNavigation,
    useRouter: () => ({ refresh: mock(), replace: mock() }),
  }));
});

afterAll(async () => {
  mock.module('next/headers', () => nextHeaders);
  mock.module('next/navigation', () => nextNavigation);
  if (userIds.length > 0) await db.delete(schema.user).where(inArray(schema.user.id, userIds));
});

const { default: SessionsPage } = await import(
  '../../../../../src/app/(app)/settings/account/sessions/page.tsx'
);

async function signIn(ageHours: number) {
  const userId = randomUUID();
  userIds.push(userId);
  await db.insert(schema.user).values({
    id: userId,
    name: 'Sessions Test',
    email: `${userId}@orbit.test`,
    handle: userId,
    emailVerified: true,
  });
  const token = randomUUID();
  await db.insert(schema.session).values({
    id: randomUUID(),
    userId,
    token,
    createdAt: new Date(Date.now() - ageHours * 3_600_000),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
  });
  const context = await auth.$context;
  const signature = createHmac('sha256', context.secret).update(token).digest('base64');
  requestHeaders = new Headers({
    host: 'localhost:3000',
    cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`,
  });
}

describe('SessionsPage', () => {
  it('lets an older valid login authenticate again without crashing or exposing sessions', async () => {
    await signIn(25);

    render(
      <ToastProvider>{await SessionsPage({ searchParams: Promise.resolve({}) })}</ToastProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    expect(screen.getByText(/sign in again/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with passkey' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeVisible();
    expect(screen.queryByTestId('sessions-panel')).toBeNull();

    mock.module('@/lib/auth/client.ts', () => ({
      authClient: { signIn: { passkey: () => Promise.resolve({ data: null, error: null }) } },
    }));
    const navigate = spyOn(window.location, 'assign').mockImplementation(() => undefined);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with passkey' }));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings/account/sessions'));
    } finally {
      mock.module('@/lib/auth/client.ts', () => authClientModule);
      navigate.mockRestore();
    }
  });

  it('shows the current device for a fresh login', async () => {
    await signIn(1);

    render(
      <ToastProvider>{await SessionsPage({ searchParams: Promise.resolve({}) })}</ToastProvider>,
    );

    expect(screen.getByTestId('sessions-panel')).toBeVisible();
    expect(screen.getByText('This device')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with passkey' })).toBeNull();
  });

  it('does not disguise an unrelated auth failure as a freshness prompt', async () => {
    await signIn(1);
    const error = new APIError('FORBIDDEN', { code: 'OTHER_ERROR', message: 'Access denied' });
    const list = spyOn(auth.api, 'listSessions').mockRejectedValue(error);
    try {
      await expect(SessionsPage({ searchParams: Promise.resolve({}) })).rejects.toBe(error);
    } finally {
      list.mockRestore();
    }
  });

  it('explains a cancelled provider sign-in while keeping recovery available', async () => {
    await signIn(25);

    const toast = mock();
    mock.module('@/components/ui/toast.tsx', () => ({
      ...toastModule,
      useToast: () => ({ toast, dismiss: mock() }),
    }));
    try {
      render(
        <ToastProvider>
          {await SessionsPage({ searchParams: Promise.resolve({ error: 'access_denied' }) })}
        </ToastProvider>,
      );

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: 'Sign in failed',
          description: 'You cancelled before granting access. Try again when you are ready.',
          tone: 'danger',
        }),
      );
      expect(screen.getByRole('button', { name: 'Continue with passkey' })).toBeVisible();
      expect(screen.queryByTestId('sessions-panel')).toBeNull();
    } finally {
      mock.module('@/components/ui/toast.tsx', () => toastModule);
    }
  });

  it('keeps provider success and cancellation callbacks on Sessions', async () => {
    await signIn(25);
    const social = mock(() => Promise.resolve({ error: null }));
    mock.module('@/lib/auth/server.ts', () => ({
      ...authServerModule,
      enabledSocialProviders: ['google'],
    }));
    mock.module('@/lib/auth/client.ts', () => ({ authClient: { signIn: { social } } }));
    try {
      render(
        <ToastProvider>{await SessionsPage({ searchParams: Promise.resolve({}) })}</ToastProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

      await waitFor(() =>
        expect(social).toHaveBeenCalledWith({
          provider: 'google',
          callbackURL: '/settings/account/sessions',
          errorCallbackURL: 'http://localhost:3000/settings/account/sessions',
        }),
      );
    } finally {
      mock.module('@/lib/auth/server.ts', () => authServerModule);
      mock.module('@/lib/auth/client.ts', () => authClientModule);
    }
  });
});
