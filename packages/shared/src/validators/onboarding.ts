import { z } from 'zod';
import { ONBOARDING_STEPS, ONBOARDING_THEMES, ORG_SIZES } from '../constants/index.ts';
import { idSchema } from './common.ts';

export const onboardingAdvanceSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  via: z.enum(['create', 'join']).optional(),
  theme: z.enum(ONBOARDING_THEMES).optional(),
  orgSize: z.enum(ORG_SIZES).optional(),
});

export const onboardingJoinSchema = z.object({
  inviteIds: z.array(idSchema).min(1).max(50),
});

export type OnboardingAdvanceInput = z.infer<typeof onboardingAdvanceSchema>;
export type OnboardingJoinInput = z.infer<typeof onboardingJoinSchema>;
