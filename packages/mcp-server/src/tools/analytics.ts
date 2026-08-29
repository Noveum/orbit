import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadAnalyticsOverview } from '@orbit/core';
import { analyticsQuerySchema } from '@orbit/shared';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { defineTool } from './support.ts';

export function registerAnalyticsTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'get_analytics_overview',
      title: 'Get Analytics Overview',
      description:
        'Retrieve a high-level analytics overview of the workspace. Use this to answer questions about throughput, median cycle time, blocked work, and current WIP. You can filter the time range and choose to measure by issues or points.',
      readOnly: true,
      inputSchema: {
        range: z
          .enum(['auto', 'last_30_days', 'last_90_days', 'all_time'])
          .default('auto')
          .describe('The time period to analyze.'),
        measure: z
          .enum(['issues', 'points'])
          .default('issues')
          .describe('Whether to calculate metrics using issue counts or estimated story points.'),
      },
    },
    async (args) => {
      const query = analyticsQuerySchema.parse({
        lens: 'overview',
        measure: args.measure,
        range: { preset: args.range },
        compare: 'auto',
        filter: { kind: 'group', combinator: 'and', children: [] },
        includeArchived: false,
        includeCanceled: false,
        focus: {},
      });

      const overview = await loadAnalyticsOverview(principal, query);

      return {
        asOf: overview.asOf,
        resolvedRange: overview.resolvedRange,
        comparisonRange: overview.comparisonRange,
        metrics: overview.cards.map((card) => ({
          id: card.id,
          metric: card.label,
          value: card.value,
          unit: card.unit,
          comparisonDelta: card.comparisonDelta,
        })),
        outliersWithheldCount: overview.outliers.length + overview.outliersWithheldCount,
      };
    },
  );
}
