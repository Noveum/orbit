import { getIssueSummary } from '@orbit/core';
import { GROUP_BY_FIELDS } from '@orbit/shared/filters';
import { issueFilterSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

const FACET_GROUPS = new Set<string>([
  'state',
  'assignee',
  'creator',
  'priority',
  'estimate',
  'label',
  'project',
  'cycle',
  'milestone',
]);

const summaryQuerySchema = issueFilterSchema.extend({
  groupBy: z
    .enum(GROUP_BY_FIELDS)
    .optional()
    .transform((value) => (value !== undefined && FACET_GROUPS.has(value) ? value : 'state')),
});

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const params = searchParamsOf(request);
    const filter = summaryQuerySchema.parse(params);
    return await getIssueSummary(principal, filter);
  });
}
