import { SLACK_INTEGRATION_ENABLED } from '@orbit/shared/constants';

export function slackIntegrationEnabled(): boolean {
  return SLACK_INTEGRATION_ENABLED;
}

export function slackIntegrationUnavailable(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}
