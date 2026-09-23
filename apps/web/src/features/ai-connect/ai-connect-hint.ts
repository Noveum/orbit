import type { OnboardingState } from '@orbit/shared/constants';

export function shouldShowAiConnectHint(
  state: OnboardingState,
  connectedClientCount: number,
): boolean {
  return state.aiConnectHintDismissed !== true && connectedClientCount === 0;
}
