import { z } from 'zod';
import { absoluteUrl } from '@/lib/env.ts';
import { integrationStateSecret, verifyOAuthState } from '@/lib/integrations/oauth-state.ts';

const callbackSchema = z.object({
  installation_id: z.string().regex(/^\d+$/),
  setup_action: z.string().optional(),
  state: z.string().min(1),
});

function settingsRedirect(status: 'connected' | 'error'): Response {
  return Response.redirect(absoluteUrl(`/settings/integrations?github=${status}`), 302);
}

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = callbackSchema.safeParse(params);
  if (!parsed.success) return settingsRedirect('error');

  const state = verifyOAuthState(parsed.data.state, integrationStateSecret(), 'github');
  if (state === null) return settingsRedirect('error');

  try {
    const { persistGithubInstallation } = await import(
      '@/features/settings/integrations-connect.ts'
    );
    await persistGithubInstallation({
      organizationId: state.org,
      userId: state.user,
      installationId: parsed.data.installation_id,
    });
    return settingsRedirect('connected');
  } catch (error) {
    console.error('Could not persist the GitHub installation.', error);
    return settingsRedirect('error');
  }
}
