import { listMcpGrants, revokeMcpGrant } from '@orbit/core';
import { validationFailed } from '@orbit/shared/errors';
import { apiContext, handleRoute, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const grants = await listMcpGrants(principal.userId);
    return { connections: grants };
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const grantId = searchParamsOf(request)['grantId'] ?? '';
    if (grantId.length === 0) throw validationFailed('A grantId is required.');
    await revokeMcpGrant(grantId, principal.userId);
    return { ok: true };
  });
}
