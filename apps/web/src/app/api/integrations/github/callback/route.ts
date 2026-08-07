import { isDomainError } from '@orbit/shared/errors';
import { githubCallbackSchema, githubInstallRequestSchema } from '@orbit/shared/validators';
import type { GithubConnectStatus } from '@/features/settings/github-view.ts';
import { absoluteUrl, githubAppConfig } from '@/lib/env.ts';
import { integrationStateSecret } from '@/lib/integrations/oauth-state.ts';
import { consumeOAuthState } from '@/lib/integrations/oauth-state-store.ts';

type CallbackStatus = GithubConnectStatus;

function settingsRedirect(status: CallbackStatus): Response {
  return Response.redirect(absoluteUrl(`/settings/integrations?github=${status}`), 302);
}

function statusForFailure(error: unknown): CallbackStatus {
  if (!isDomainError(error)) return 'error';
  if (error.code === 'forbidden') return 'denied';
  if (error.code === 'conflict') return 'claimed';
  return 'error';
}

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  if (githubInstallRequestSchema.safeParse(params).success) return settingsRedirect('denied');

  const parsed = githubCallbackSchema.safeParse(params);
  if (!parsed.success) return settingsRedirect('error');

  const state = await consumeOAuthState(parsed.data.state, integrationStateSecret(), 'github');
  if (state === null) return settingsRedirect('error');

  try {
    const { completeGithubInstall } = await import('@/features/settings/github-connect.ts');
    await completeGithubInstall({
      organizationId: state.org,
      userId: state.user,
      installationId: parsed.data.installation_id,
      code: parsed.data.code,
      config: githubAppConfig(),
    });
    return settingsRedirect('connected');
  } catch (error) {
    console.error('Could not complete the GitHub installation.', error);
    return settingsRedirect(statusForFailure(error));
  }
}
