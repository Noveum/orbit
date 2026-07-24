import { listDocVersions, restoreDocVersion } from '@orbit/core';
import { z } from 'zod';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

const restoreSchema = z.object({ versionId: z.string().min(1).max(64) });

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const versions = await listDocVersions(principal, id);
    return {
      versions: versions.map((version) => ({
        id: version.id,
        title: version.title,
        ownedById: version.ownedById,
        restoredFromId: version.restoredFromId,
        lastSavedAt: version.lastSavedAt,
      })),
    };
  });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const { versionId } = restoreSchema.parse(body);
    const saved = await restoreDocVersion(principal, id, versionId);
    await publish(saved.actions);
    return { doc: saved.doc };
  });
}
