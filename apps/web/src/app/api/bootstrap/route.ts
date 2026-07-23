import { bootstrapQuerySchema } from '@orbit/shared/validators';
import { bootstrapPayload, bootstrapVersion } from '@/lib/api/bootstrap.ts';
import { cachedJson, handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = bootstrapQuerySchema.parse(searchParamsOf(request));
    const version = await bootstrapVersion(principal);
    return await cachedJson(request, version, async () => await bootstrapPayload(principal, query));
  });
}
