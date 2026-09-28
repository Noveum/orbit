import { getOnboardingStatus, type OnboardingStatus } from '@orbit/core';
import { cache } from 'react';

export const onboardingStatusFor = cache(
  (userId: string): Promise<OnboardingStatus> => getOnboardingStatus(userId),
);
