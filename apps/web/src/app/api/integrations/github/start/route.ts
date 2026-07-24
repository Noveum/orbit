import { validationFailed } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { apiContext, handleRoute } from '@/lib/api/handler.ts';
import { githubAppConfig, githubConnectReady } from '@/lib/env.ts';
import { integrationStateSecret, signOAuthState } from '@/lib/integrations/oauth-state.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    if (!githubConnectReady()) throw validationFailed('The GitHub App is not configured yet.');

    const state = signOAuthState(
      { org: principal.organizationId, user: principal.userId, provider: 'github' },
      integrationStateSecret(),
    );
    const url = new URL(`https://github.com/apps/${githubAppConfig().slug}/installations/new`);
    url.searchParams.set('state', state);
    return Response.redirect(url.toString(), 302);
  });
}
