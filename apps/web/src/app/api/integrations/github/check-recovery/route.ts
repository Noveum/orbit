import { db } from '@orbit/db';
import { listGithubCheckRecoveryCandidates, requestGithubCheckRecovery } from '@orbit/services';
import { conflict } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { githubRecoveryQuerySchema, githubRecoveryRequestSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { githubAppConfig } from '@/lib/env.ts';

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const query = githubRecoveryQuerySchema.parse(searchParamsOf(request));
    const page = await listGithubCheckRecoveryCandidates(db, principal, query);
    return Response.json(page, {
      headers: { 'cache-control': 'private, no-store' },
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const selector = githubRecoveryRequestSchema.parse(await readJson(request));
    const config = githubAppConfig();
    if (config.appId.length === 0 || config.privateKey.length === 0) {
      throw conflict('The GitHub App is not configured.');
    }
    return await requestGithubCheckRecovery(db, {
      organizationId: principal.organizationId,
      userId: principal.userId,
      selector,
      appId: config.appId,
      privateKey: config.privateKey,
      signal: request.signal,
    });
  });
}
