import { measureSchema, stateGroupBreakdown } from '@orbit/core';
import { z } from 'zod';
import { toCsv } from '@/features/analytics/csv.ts';
import { STATE_GROUP_ORDER, stateGroupLabel } from '@/features/analytics/labels.ts';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

const dimensionSchema = z.enum(['assignee', 'project', 'label']).catch('assignee');

export async function GET(request: Request): Promise<Response> {
  const params = searchParamsOf(request);
  const dimension = dimensionSchema.parse(params['dimension']);
  const measure = measureSchema.catch('issues').parse(params['measure']);

  return await handle(async (principal) => {
    const breakdown = await stateGroupBreakdown(
      principal,
      { type: 'workspace' },
      dimension,
      measure,
    );
    const segmentKeys = STATE_GROUP_ORDER.filter((key) => key in breakdown.schema);
    const header = [
      dimension.charAt(0).toUpperCase() + dimension.slice(1),
      ...segmentKeys.map((key) => stateGroupLabel(key)),
      'Total',
    ];
    const rows = breakdown.data.map((datum) => [
      datum.name,
      ...segmentKeys.map((key) => datum.values[key] ?? 0),
      datum.total,
    ]);
    const csv = toCsv([header, ...rows]);

    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="orbit-${dimension}-breakdown.csv"`,
      },
    });
  });
}
