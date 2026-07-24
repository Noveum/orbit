import { validationFailed } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { apiContext, handleRoute } from '@/lib/api/handler.ts';
import { absoluteUrl, slackAppConfig, slackConnectReady } from '@/lib/env.ts';
import { integrationStateSecret, signOAuthState } from '@/lib/integrations/oauth-state.ts';

const SLACK_BOT_SCOPES = 'channels:read,groups:read,chat:write,links:read,commands';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    if (!slackConnectReady()) throw validationFailed('The Slack app is not configured yet.');

    const state = signOAuthState(
      { org: principal.organizationId, user: principal.userId, provider: 'slack' },
      integrationStateSecret(),
    );
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', slackAppConfig().clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', absoluteUrl('/api/integrations/slack/callback'));
    return Response.redirect(url.toString(), 302);
  });
}
