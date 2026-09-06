import { isDomainError } from '@orbit/shared/errors';

export type SlackCallbackStatus = 'connected' | 'error' | 'denied' | 'claimed';

export function slackCallbackStatusForFailure(error: unknown): SlackCallbackStatus {
  if (!isDomainError(error)) return 'error';
  if (error.code === 'forbidden') return 'denied';
  if (error.code === 'conflict' && error.details?.['reason'] === 'slack_team_claimed') {
    return 'claimed';
  }
  return 'error';
}
