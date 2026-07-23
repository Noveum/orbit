import { z } from 'zod';

export const MEASURES = ['issues', 'points'] as const;
export const measureSchema = z.enum(MEASURES);
export type Measure = (typeof MEASURES)[number];

export const CHART_DIMENSIONS = [
  'state',
  'state_group',
  'assignee',
  'project',
  'label',
  'priority',
  'estimate',
  'cycle',
  'created_month',
  'completed_month',
] as const;
export const chartDimensionSchema = z.enum(CHART_DIMENSIONS);
export type ChartDimension = (typeof CHART_DIMENSIONS)[number];

export const analyticsScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace') }),
  z.object({ type: z.literal('team'), id: z.string().min(1) }),
  z.object({ type: z.literal('project'), id: z.string().min(1) }),
  z.object({ type: z.literal('cycle'), id: z.string().min(1) }),
]);
export type AnalyticsScope = z.infer<typeof analyticsScopeSchema>;

export const chartRequestSchema = z.object({
  scope: analyticsScopeSchema.default({ type: 'workspace' }),
  xAxis: chartDimensionSchema,
  segment: chartDimensionSchema.optional(),
  measure: measureSchema.default('issues'),
});
export type ChartRequest = z.infer<typeof chartRequestSchema>;

export const breakdownRequestSchema = z.object({
  scope: analyticsScopeSchema.default({ type: 'workspace' }),
  dimension: z.enum(['assignee', 'project', 'label']).default('assignee'),
  measure: measureSchema.default('issues'),
});
export type BreakdownRequest = z.infer<typeof breakdownRequestSchema>;

const analyticsViewConfigSchema = z
  .object({
    scope: analyticsScopeSchema.optional(),
    measure: measureSchema.optional(),
    xAxis: chartDimensionSchema.optional(),
    segment: chartDimensionSchema.optional(),
  })
  .catchall(z.unknown());

export const savedAnalyticsViewCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopeType: z.enum(['workspace', 'team', 'project', 'cycle']).default('workspace'),
  scopeId: z.string().min(1).nullable().default(null),
  config: analyticsViewConfigSchema.default({}),
  shared: z.boolean().default(false),
});
export type SavedAnalyticsViewCreate = z.infer<typeof savedAnalyticsViewCreateSchema>;

export const savedAnalyticsViewUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    config: analyticsViewConfigSchema.optional(),
    shared: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });
export type SavedAnalyticsViewUpdate = z.infer<typeof savedAnalyticsViewUpdateSchema>;

export const checkpointCreateSchema = z.object({
  cycleId: z.string().min(1),
  label: z.string().trim().min(1).max(120),
});
export type CheckpointCreate = z.infer<typeof checkpointCreateSchema>;
