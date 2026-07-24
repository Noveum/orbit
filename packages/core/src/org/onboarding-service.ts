import { count, db, eq, schema } from '@orbit/db';
import {
  ONBOARDING_DONE,
  type OnboardingState,
  type OnboardingStep,
  resolveOnboardingStep,
} from '@orbit/shared/constants';
import { type OnboardingAdvanceInput, onboardingAdvanceSchema } from '@orbit/shared/validators';
import { type Executor, requireRow } from '../internal.ts';

export interface OnboardingStatus {
  readonly userId: string;
  readonly name: string;
  readonly handle: string;
  readonly email: string;
  readonly image: string | null;
  readonly state: OnboardingState;
  readonly hasWorkspace: boolean;
  readonly completed: boolean;
  readonly step: OnboardingStep | typeof ONBOARDING_DONE;
}

async function hasAnyWorkspace(executor: Executor, userId: string): Promise<boolean> {
  const [row] = await executor
    .select({ total: count() })
    .from(schema.member)
    .where(eq(schema.member.userId, userId));
  return (row?.total ?? 0) > 0;
}

async function loadStatus(executor: Executor, userId: string): Promise<OnboardingStatus> {
  const [user] = await executor
    .select({
      name: schema.user.name,
      handle: schema.user.handle,
      email: schema.user.email,
      image: schema.user.image,
      onboardingState: schema.user.onboardingState,
      onboardingCompletedAt: schema.user.onboardingCompletedAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  const row = requireRow(user, 'That account does not exist.');
  const state = row.onboardingState as OnboardingState;
  const completed = row.onboardingCompletedAt !== null;
  const hasWorkspace = completed ? true : await hasAnyWorkspace(executor, userId);
  return {
    userId,
    name: row.name,
    handle: row.handle,
    email: row.email,
    image: row.image,
    state,
    hasWorkspace,
    completed,
    step: completed ? ONBOARDING_DONE : resolveOnboardingStep(state, { hasWorkspace }),
  };
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  return await loadStatus(db, userId);
}

function applyStep(state: OnboardingState, input: OnboardingAdvanceInput): Record<string, unknown> {
  const next: Record<string, unknown> = { ...state };
  if (input.step === 'profile') next['profileComplete'] = true;
  if (input.step === 'workspace') {
    if (input.via === 'join') next['workspaceJoin'] = true;
    else next['workspaceCreate'] = true;
    if (input.orgSize !== undefined) next['orgSize'] = input.orgSize;
  }
  if (input.step === 'invite') next['workspaceInvite'] = true;
  if (input.step === 'theme') {
    next['themeSet'] = true;
    if (input.theme !== undefined) next['theme'] = input.theme;
  }
  return next;
}

export async function advanceOnboarding(userId: string, input: unknown): Promise<OnboardingStatus> {
  const parsed = onboardingAdvanceSchema.parse(input);
  return await db.transaction(async (tx) => {
    const current = await loadStatus(tx, userId);
    if (current.completed) return current;

    const state = applyStep(current.state, parsed);
    const next = resolveOnboardingStep(state as OnboardingState, {
      hasWorkspace: current.hasWorkspace,
    });
    const completedAt = next === ONBOARDING_DONE ? new Date() : null;

    await tx
      .update(schema.user)
      .set({
        onboardingState: state,
        onboardingStep: next,
        ...(completedAt === null ? {} : { onboardingCompletedAt: completedAt }),
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId));

    return {
      ...current,
      state: state as OnboardingState,
      completed: completedAt !== null,
      step: next,
    };
  });
}

export async function completeOnboarding(userId: string): Promise<OnboardingStatus> {
  return await db.transaction(async (tx) => {
    const current = await loadStatus(tx, userId);
    if (current.completed) return current;
    await tx
      .update(schema.user)
      .set({
        onboardingStep: ONBOARDING_DONE,
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId));
    return { ...current, completed: true, step: ONBOARDING_DONE };
  });
}
