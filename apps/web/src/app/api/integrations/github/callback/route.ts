import { isDomainError } from '@orbit/shared/errors';
import { githubCallbackSchema } from '@orbit/shared/validators';
import type { GithubConnectStatus } from '@/features/settings/github-view.ts';
import { absoluteUrl, githubAppConfig } from '@/lib/env.ts';
import { integrationStateSecret, verifyOAuthState } from '@/lib/integrations/oauth-state.ts';

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
  const parsed = githubCallbackSchema.safeParse(params);
  if (!parsed.success) return settingsRedirect('error');
  if (parsed.data.setup_action === 'request') return settingsRedirect('denied');

  const state = verifyOAuthState(parsed.data.state, integrationStateSecret(), 'github');
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
