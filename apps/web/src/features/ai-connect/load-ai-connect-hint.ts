import { listMcpGrants } from '@orbit/core';
import { onboardingStatusFor } from '@/lib/onboarding-status.ts';
import { shouldShowAiConnectHint } from './ai-connect-hint.ts';

export async function aiConnectHintVisible(userId: string): Promise<boolean> {
  const { state } = await onboardingStatusFor(userId);
  if (state.aiConnectHintDismissed === true) return false;
  const grants = await listMcpGrants(userId);
  return shouldShowAiConnectHint(state, grants.length);
}
