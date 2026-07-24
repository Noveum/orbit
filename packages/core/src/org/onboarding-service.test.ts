import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { createUser, createWorkspace, resetDatabase } from '../test-support.ts';
import { advanceOnboarding, getOnboardingStatus } from './onboarding-service.ts';
import { createOrganization } from './organization-service.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('getOnboardingStatus', () => {
  it('starts a fresh user at the profile step with no workspace', async () => {
    const user = await createUser('Nia New');
    const status = await getOnboardingStatus(user.id);
    expect(status.step).toBe('profile');
    expect(status.hasWorkspace).toBe(false);
    expect(status.completed).toBe(false);
  });
});

describe('advanceOnboarding', () => {
  it('persists each step so a resume returns to the same place', async () => {
    const user = await createUser('Nia New');
    await advanceOnboarding(user.id, { step: 'profile' });

    const resumed = await getOnboardingStatus(user.id);
    expect(resumed.step).toBe('workspace');
    expect(resumed.state.profileComplete).toBe(true);
  });

  it('marks the workspace step done via create and moves to invites', async () => {
    const user = await createUser('Nia New');
    await advanceOnboarding(user.id, { step: 'profile' });
    await createOrganization(user.id, { name: 'Nia Co', slug: 'nia-co' });
    const status = await advanceOnboarding(user.id, {
      step: 'workspace',
      via: 'create',
      orgSize: '2_10',
    });
    expect(status.step).toBe('invite');
    expect(status.state.workspaceCreate).toBe(true);
    expect(status.state.orgSize).toBe('2_10');
  });

  it('completes onboarding after the final step and never resets it', async () => {
    const user = await createUser('Nia New');
    await advanceOnboarding(user.id, { step: 'profile' });
    await createOrganization(user.id, { name: 'Nia Co', slug: 'nia-co' });
    await advanceOnboarding(user.id, { step: 'workspace', via: 'create' });
    await advanceOnboarding(user.id, { step: 'invite' });
    const done = await advanceOnboarding(user.id, { step: 'theme', theme: 'dark' });

    expect(done.step).toBe('done');
    expect(done.completed).toBe(true);

    const [row] = await db
      .select({ completedAt: schema.user.onboardingCompletedAt })
      .from(schema.user)
      .where(eq(schema.user.id, user.id));
    expect(row?.completedAt).not.toBeNull();

    const again = await advanceOnboarding(user.id, { step: 'profile' });
    expect(again.completed).toBe(true);
    expect(again.step).toBe('done');
  });

  it('skips the workspace step when the user already belongs to one', async () => {
    const workspace = await createWorkspace('Nova');
    const status = await getOnboardingStatus(workspace.adminUser.id);
    expect(status.hasWorkspace).toBe(true);

    const next = await advanceOnboarding(workspace.adminUser.id, { step: 'profile' });
    expect(next.step).toBe('invite');
  });
});
