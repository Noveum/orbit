import { assertCan } from '@orbit/shared/policy';
import { loadGithubSettings } from '@/features/settings/github-data.ts';
import { apiContext, handleRoute } from '@/lib/api/handler.ts';

export async function POST(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    return await loadGithubSettings(principal, { refresh: true });
  });
}
