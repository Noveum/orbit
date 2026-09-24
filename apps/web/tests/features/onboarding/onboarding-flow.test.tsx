import { afterEach, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingFlow } from '@/features/onboarding/onboarding-flow.tsx';
import type { OnboardingStatusView } from '@/features/onboarding/types.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('shows verification guidance when an unverified user advances from profile to workspace', async () => {
  const status: OnboardingStatusView = {
    name: 'New Member',
    handle: 'new-member',
    email: 'new@example.com',
    image: null,
    state: {},
    hasWorkspace: false,
    completed: false,
    step: 'profile',
  };
  globalThis.fetch = mock(() =>
    Promise.resolve(
      Response.json({
        onboarding: { ...status, step: 'workspace' },
      }),
    ),
  ) as unknown as typeof fetch;
  render(
    <OnboardingFlow
      initialStep="profile"
      status={status}
      invites={[]}
      landingPath="/my-issues"
      mcpUrl="https://orbit.example/mcp"
      emailEnabled
      emailVerificationRequired
    />,
  );
  expect(screen.queryByRole('link', { name: 'Sign in with an emailed code' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('link', { name: 'Sign in with an emailed code' })).toHaveAttribute(
    'href',
    '/login?reauth=1&next=/onboarding',
  );
});

it('moves from teammates to the AI tool step and labels it in the progress bar', async () => {
  const status: OnboardingStatusView = {
    name: 'New Member',
    handle: 'new-member',
    email: 'new@example.com',
    image: null,
    state: { profileComplete: true },
    hasWorkspace: true,
    completed: false,
    step: 'invite',
  };
  globalThis.fetch = mock(() =>
    Promise.resolve(Response.json({ onboarding: { ...status, step: 'connect' } })),
  ) as unknown as typeof fetch;
  render(
    <OnboardingFlow
      initialStep="invite"
      status={status}
      invites={[]}
      landingPath="/my-issues"
      mcpUrl="https://orbit.example/mcp"
      emailEnabled={false}
      emailVerificationRequired={false}
    />,
  );
  expect(screen.getByText('AI tool')).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('heading', { name: 'Bring your work in with AI' })).toBeVisible();
});
