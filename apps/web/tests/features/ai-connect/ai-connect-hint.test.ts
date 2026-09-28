import { describe, expect, it } from 'bun:test';
import { shouldShowAiConnectHint } from '@/features/ai-connect/ai-connect-hint.ts';

describe('shouldShowAiConnectHint', () => {
  it('shows the hint to a user with no connected AI client who has not dismissed it', () => {
    expect(shouldShowAiConnectHint({}, 0)).toBe(true);
  });

  it('hides the hint once any AI client is connected', () => {
    expect(shouldShowAiConnectHint({}, 1)).toBe(false);
    expect(shouldShowAiConnectHint({}, 2)).toBe(false);
  });

  it('hides the hint after the user dismisses it', () => {
    expect(shouldShowAiConnectHint({ aiConnectHintDismissed: true }, 0)).toBe(false);
  });
});
