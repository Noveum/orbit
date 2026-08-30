import { SLACK_INTEGRATION_ENABLED } from '@orbit/shared/constants';

export function slackIntegrationEnabled(): boolean {
  return SLACK_INTEGRATION_ENABLED;
}

export function slackEnabledOrganizationId(): string | null {
  const value = process.env['SLACK_ENABLED_ORGANIZATION_ID']?.trim() ?? '';
  return value.length === 0 ? null : value;
}

export function slackIntegrationEnabledForOrganization(organizationId: string): boolean {
  return slackEnabledOrganizationId() === organizationId;
}

export function slackRolloutConfigured(): boolean {
  return slackEnabledOrganizationId() !== null;
}

export function slackIntegrationUnavailable(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}
