import { buildChart, chartRequestSchema } from '@orbit/core';
import { handle, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const input = chartRequestSchema.parse(body);
    const chart = await buildChart(principal, {
      scope: input.scope,
      xAxis: input.xAxis,
      segment: input.segment,
      measure: input.measure,
    });
    return { chart };
  });
}
