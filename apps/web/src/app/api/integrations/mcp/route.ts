import { listMcpGrants, revokeMcpGrant } from '@orbit/core';
import { validationFailed } from '@orbit/shared/errors';
import { mcpGrantQuerySchema } from '@orbit/shared/validators';
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
    const parsed = mcpGrantQuerySchema.safeParse(searchParamsOf(request));
    if (!parsed.success) throw validationFailed('A grantId is required.');
    await revokeMcpGrant(parsed.data.grantId, principal);
    return { ok: true };
  });
}
