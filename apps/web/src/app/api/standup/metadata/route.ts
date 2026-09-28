import { getStandupMetadata } from '@orbit/core';
import { handle } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handle(async (principal) => await getStandupMetadata(principal));
}
