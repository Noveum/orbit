import { slackFeatureEnabled } from '@orbit/services/slack/feature';

export function slackIntegrationEnabled(): boolean {
  return slackFeatureEnabled();
}

export function slackIntegrationEnabledForOrganization(_organizationId: string): boolean {
  return slackFeatureEnabled();
}

export function slackRolloutConfigured(): boolean {
  return slackFeatureEnabled();
}

export function slackIntegrationUnavailable(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}
