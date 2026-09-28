import { beforeEach, describe, expect, it } from 'bun:test';
import { createInvite } from '@orbit/core';
import { createUser, createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { mockSession } from '../../../tests-support.ts';

let userId = '';
let emailVerified = true;
let inviteId = '';

mockSession(() => ({ user: { id: userId, emailVerified } }));

const { default: OnboardingPage } = await import(
  '../../../src/app/(onboarding)/onboarding/page.tsx'
);

beforeEach(async () => {
  await resetDatabase();
  const workspace = await createWorkspace('onboarding-invites');
  const user = await createUser('Invited Starter');
  userId = user.id;
  emailVerified = true;
  const created = await createInvite(workspace.admin, { email: user.email });
  inviteId = created.invitation.id;
});

describe('OnboardingPage invitations', () => {
  it('loads verified invitations before the profile step advances in the browser', async () => {
    const page = await OnboardingPage({ searchParams: Promise.resolve({}) });
    expect(page.props.initialStep).toBe('profile');
    expect(page.props.invites).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: inviteId })]),
    );
    expect(page.props.emailVerificationRequired).toBe(false);
  });

  it('keeps invitations private and carries verification guidance through the flow', async () => {
    emailVerified = false;
    const page = await OnboardingPage({ searchParams: Promise.resolve({}) });
    expect(page.props.invites).toEqual([]);
    expect(page.props.emailVerificationRequired).toBe(true);
  });
});
