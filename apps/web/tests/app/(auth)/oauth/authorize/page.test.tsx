import { afterAll, describe, expect, it, mock } from 'bun:test';
import { forbidden, internal, unauthorized } from '@orbit/shared/errors';
import { render, screen } from '@testing-library/react';
import { mockSession } from '../../../../../tests-support.ts';

const coreModule = { ...(await import('@orbit/core')) };
let consentError: Error;

mockSession(() => ({ user: { id: 'consent-owner', email: 'owner@example.com' } }));
mock.module('@orbit/core', () => ({
  ...coreModule,
  getMcpConsentRequest: () => Promise.reject(consentError),
}));

const { default: AuthorizePage } = await import('@/app/(auth)/oauth/authorize/page.tsx');

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

function page() {
  return AuthorizePage({ searchParams: Promise.resolve({ consent_code: 'request-code' }) });
}

describe('MCP consent lookup errors', () => {
  for (const error of [unauthorized('Expired consent'), forbidden('Wrong owner')]) {
    it(`renders the expired request message for ${error.code}`, async () => {
      consentError = error;
      render(await page());
      expect(
        screen.getByText(/This authorization request is invalid or has expired/),
      ).toBeVisible();
    });
  }

  for (const error of [new Error('Database connection failed'), internal('Database timeout')]) {
    it(`propagates ${error.message} to the server error boundary`, async () => {
      consentError = error;
      await expect(page()).rejects.toBe(error);
    });
  }
});
