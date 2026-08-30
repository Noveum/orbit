import { isDomainError } from '@orbit/shared/errors';
import { z } from 'zod';
import { absoluteUrl, slackAppConfig } from '@/lib/env.ts';
import { integrationStateSecret } from '@/lib/integrations/oauth-state.ts';
import { consumeOAuthState } from '@/lib/integrations/oauth-state-store.ts';
import {
  slackIntegrationEnabledForOrganization,
  slackIntegrationUnavailable,
  slackRolloutConfigured,
} from '@/lib/integrations/slack-capability.ts';

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

type SlackCallbackStatus = 'connected' | 'error' | 'denied' | 'claimed';

function settingsRedirect(status: SlackCallbackStatus): Response {
  return Response.redirect(absoluteUrl(`/settings/integrations?slack=${status}`), 302);
}

function statusForFailure(error: unknown): SlackCallbackStatus {
  if (!isDomainError(error)) return 'error';
  if (error.code === 'forbidden') return 'denied';
  if (error.code === 'conflict' && error.details?.['reason'] === 'slack_team_claimed') {
    return 'claimed';
  }
  return 'error';
}

export async function GET(request: Request): Promise<Response> {
  if (!slackRolloutConfigured()) return slackIntegrationUnavailable();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = callbackSchema.safeParse(params);
  if (!parsed.success) return settingsRedirect('error');

  const state = await consumeOAuthState(parsed.data.state, integrationStateSecret(), 'slack');
  if (state === null) return settingsRedirect('error');
  if (!slackIntegrationEnabledForOrganization(state.org)) return slackIntegrationUnavailable();

  const config = slackAppConfig();
  try {
    const { completeSlackInstall } = await import('@/features/settings/integrations-connect.ts');
    await completeSlackInstall({
      organizationId: state.org,
      userId: state.user,
      code: parsed.data.code,
      redirectUri: absoluteUrl('/api/integrations/slack/callback'),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    return settingsRedirect('connected');
  } catch (error) {
    console.error('Could not complete the Slack installation.', error);
    return settingsRedirect(statusForFailure(error));
  }
}
