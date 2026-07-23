import { describe, expect, it } from 'bun:test';
import { isReservedWorkspaceSlug, resolveOnboardingStep } from '../constants/index.ts';
import { onboardingAdvanceSchema, onboardingJoinSchema } from './onboarding.ts';
import { organizationCreateSchema, workspaceSlugSchema } from './organization.ts';

describe('workspaceSlugSchema', () => {
  it('accepts an ordinary workspace address', () => {
    expect(workspaceSlugSchema.safeParse('noveum-labs').success).toBe(true);
  });

  it('rejects reserved slugs, matching the shared denylist on both sides', () => {
    for (const slug of ['admin', 'settings', 'onboarding', 'api', 'new', 'workspaces']) {
      expect(isReservedWorkspaceSlug(slug)).toBe(true);
      expect(workspaceSlugSchema.safeParse(slug).success).toBe(false);
      expect(organizationCreateSchema.safeParse({ name: 'Fine Name', slug }).success).toBe(false);
    }
  });

  it('rejects invalid characters and slugs longer than 48', () => {
    expect(workspaceSlugSchema.safeParse('Not Valid').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('a'.repeat(49)).success).toBe(false);
  });
});

describe('resolveOnboardingStep', () => {
  it('walks profile, workspace, invite, theme, then done', () => {
    expect(resolveOnboardingStep({}, { hasWorkspace: false })).toBe('profile');
    expect(resolveOnboardingStep({ profileComplete: true }, { hasWorkspace: false })).toBe(
      'workspace',
    );
    expect(
      resolveOnboardingStep(
        { profileComplete: true, workspaceCreate: true },
        { hasWorkspace: false },
      ),
    ).toBe('invite');
    expect(
      resolveOnboardingStep(
        { profileComplete: true, workspaceJoin: true, workspaceInvite: true },
        { hasWorkspace: false },
      ),
    ).toBe('theme');
    expect(
      resolveOnboardingStep(
        { profileComplete: true, workspaceCreate: true, workspaceInvite: true, themeSet: true },
        { hasWorkspace: false },
      ),
    ).toBe('done');
  });

  it('treats an existing workspace as satisfying the workspace step', () => {
    expect(resolveOnboardingStep({ profileComplete: true }, { hasWorkspace: true })).toBe('invite');
  });
});

describe('onboarding request schemas', () => {
  it('parses an advance with optional data and rejects an unknown step', () => {
    expect(onboardingAdvanceSchema.parse({ step: 'theme', theme: 'dark' })).toEqual({
      step: 'theme',
      theme: 'dark',
    });
    expect(onboardingAdvanceSchema.safeParse({ step: 'nope' }).success).toBe(false);
  });

  it('requires at least one invite id to join', () => {
    expect(onboardingJoinSchema.safeParse({ inviteIds: [] }).success).toBe(false);
    expect(onboardingJoinSchema.safeParse({ inviteIds: ['abc'] }).success).toBe(true);
  });
});
