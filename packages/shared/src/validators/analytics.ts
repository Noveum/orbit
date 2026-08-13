import { z } from 'zod';
import { filterGroupQuerySchema } from '../filters/index.ts';
import { idSchema } from './common.ts';

export const ANALYTICS_LENSES = ['overview', 'sprints', 'projects', 'people'] as const;
export const ANALYTICS_MEASURES = ['issues', 'points'] as const;
export const ANALYTICS_COMPARE = ['auto', 'none', 'previous_period', 'previous_sprint'] as const;
export const ANALYTICS_RANGE_PRESETS = [
  'auto',
  'active_sprint',
  'previous_sprint',
  'last_30_days',
  'last_90_days',
  'all_time',
  'custom',
] as const;

const analyticsPresetRangeSchema = z.object({
  preset: z.enum([
    'auto',
    'active_sprint',
    'previous_sprint',
    'last_30_days',
    'last_90_days',
    'all_time',
  ]),
});

const analyticsCustomRangeSchema = z
  .object({
    preset: z.literal('custom'),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((range) => range.from <= range.to, {
    message: 'The custom range must end on or after its start.',
    path: ['to'],
  });

export const analyticsRangeSchema = z.discriminatedUnion('preset', [
  analyticsPresetRangeSchema,
  analyticsCustomRangeSchema,
]);

export const analyticsFocusSchema = z.object({
  projectId: idSchema.optional(),
  personId: idSchema.optional(),
});

export const analyticsDrilldownCohortSchema = z.object({
  cohort: z.string().trim().min(1).max(64),
  bucket: z.iso.date().optional(),
});

export const analyticsQuerySchema = z.object({
  version: z.literal(1).default(1),
  lens: z.enum(ANALYTICS_LENSES).default('overview'),
  range: analyticsRangeSchema.default({ preset: 'auto' }),
  compare: z.enum(ANALYTICS_COMPARE).default('auto'),
  measure: z.enum(ANALYTICS_MEASURES).default('issues'),
  filter: filterGroupQuerySchema,
  includeArchived: z.boolean().default(false),
  includeCanceled: z.boolean().default(false),
  focus: analyticsFocusSchema.default({}),
});

export const analyticsDrilldownQuerySchema = analyticsQuerySchema.extend({
  cohort: analyticsDrilldownCohortSchema,
  cursor: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AnalyticsLens = (typeof ANALYTICS_LENSES)[number];
export type AnalyticsMeasure = (typeof ANALYTICS_MEASURES)[number];
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;
export type AnalyticsCompare = (typeof ANALYTICS_COMPARE)[number];
export type AnalyticsFocus = z.infer<typeof analyticsFocusSchema>;
export type AnalyticsDrilldownCohort = z.infer<typeof analyticsDrilldownCohortSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsDrilldownQuery = z.infer<typeof analyticsDrilldownQuerySchema>;
