import { bulkUpdateIssues } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await bulkUpdateIssues(principal, body);
    await publish(result.actions);
    return { issues: await attachLabels(result.issues) };
  });
}
