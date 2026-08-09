import {
  deleteOrganization,
  getOrganizationDeletionSummary,
  publishOrganizationDeleted,
} from '@orbit/core';
import {
  organizationDeletionResponseSchema,
  organizationDeletionSummaryResponseSchema,
} from '@orbit/shared/validators';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';

const NO_CACHE_HEADERS = { 'cache-control': 'private, no-cache' } as const;

async function publishDeletion(organizationId: string): Promise<void> {
  try {
    await publishOrganizationDeleted(organizationId);
  } catch (error: unknown) {
    console.error(
      'Could not publish the workspace deletion, the write is already committed.',
      error,
    );
  }
}

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext({ allowDeleting: true });
    const summary = await getOrganizationDeletionSummary(principal);
    return Response.json(organizationDeletionSummaryResponseSchema.parse({ summary }), {
      headers: NO_CACHE_HEADERS,
    });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext({ allowDeleting: true });
    const deleted = await deleteOrganization(principal, await readJson(request));
    await publishDeletion(deleted.deletedOrganizationId);
    return organizationDeletionResponseSchema.parse({
      deletedOrganizationId: deleted.deletedOrganizationId,
      nextOrganizationId: deleted.nextOrganizationId,
    });
  });
}
