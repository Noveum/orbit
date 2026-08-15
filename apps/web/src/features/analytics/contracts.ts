import { PROJECT_HEALTHS, PROJECT_STATUSES } from '@orbit/shared/constants';
import { analyticsDrilldownCohortSchema } from '@orbit/shared/validators';
import { z } from 'zod';

const dateTimeSchema = z.iso.datetime();
const calendarDateSchema = z.iso.date();
const nullableCalendarDateSchema = calendarDateSchema.nullable();
const nullableDateTimeSchema = dateTimeSchema.nullable();
const numberSchema = z.number().finite();

export const analyticsCoverageSchema = z.object({
  kind: z.enum(['live', 'captured', 'observed', 'reconstructed', 'frozen']),
  from: dateTimeSchema.nullable(),
  asOf: dateTimeSchema,
});

const analyticsUnitSchema = z.enum(['issues', 'points', 'days', 'percent']);
const analyticsBucketSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: numberSchema,
  unit: analyticsUnitSchema,
  cohort: analyticsDrilldownCohortSchema,
});

const overviewMetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: numberSchema,
  unit: analyticsUnitSchema,
  comparisonDelta: numberSchema.nullable(),
  cohort: analyticsDrilldownCohortSchema,
  reconciliation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('total'), cohortCount: z.number().int().nonnegative() }),
    z.object({
      kind: z.literal('detail'),
      cohortCount: z.number().int().nonnegative(),
      detail: z.enum(['cycleTimeP50', 'cycleTimeP85']),
    }),
  ]),
});

export const analyticsOverviewResponseSchema = z.object({
  lens: z.literal('overview'),
  asOf: dateTimeSchema,
  coverage: analyticsCoverageSchema,
  cards: z.array(overviewMetricSchema),
  delivery: z.array(
    z.object({
      date: calendarDateSchema,
      created: numberSchema,
      completed: numberSchema,
      open: numberSchema,
      createdCohort: analyticsDrilldownCohortSchema,
      completedCohort: analyticsDrilldownCohortSchema,
      openCohort: analyticsDrilldownCohortSchema,
    }),
  ),
  state: z.array(analyticsBucketSchema),
  projects: z.array(analyticsBucketSchema),
  priorities: z.array(analyticsBucketSchema),
  outliers: z.array(
    z.object({
      issueId: z.string(),
      identifier: z.string(),
      title: z.string(),
      cycleTimeDays: numberSchema,
      cohort: analyticsDrilldownCohortSchema,
    }),
  ),
});

const sprintSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number().int(),
  teamId: z.string().nullable(),
  timezone: z.string(),
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema,
  completedAt: nullableDateTimeSchema,
  archivedAt: nullableDateTimeSchema,
});

const sprintMeasureSummarySchema = z.object({
  planned: numberSchema,
  currentScope: numberSchema,
  completed: numberSchema,
  remaining: numberSchema,
  added: numberSchema,
  removed: numberSchema,
  carryover: numberSchema,
  unestimated: z.number().int().nonnegative(),
});

const sprintBurnPointSchema = z.object({
  date: calendarDateSchema,
  calendarDay: z.number().int(),
  workingDay: z.number().int().nullable(),
  scope: numberSchema,
  started: numberSchema,
  completed: numberSchema,
  remaining: numberSchema,
  added: numberSchema,
  removed: numberSchema,
  ideal: numberSchema,
  available: z.boolean(),
  coverage: analyticsCoverageSchema.shape.kind,
  future: z.boolean(),
});

const distributionSchema = z.object({
  count: z.number().int().nonnegative(),
  p50: numberSchema,
  p85: numberSchema,
  min: numberSchema,
  max: numberSchema,
  average: numberSchema,
});

const sprintFlowSchema = z.object({
  leadTime: distributionSchema,
  cycleTime: distributionSchema,
  completed: z.number().int().nonnegative(),
  leadTimeCoverage: z.enum(['current-row', 'unavailable']),
  cycleTimeCoverage: z.enum(['current-column', 'reconstructed-current-column', 'unavailable']),
});

const personSprintBurnSchema = z.object({
  personId: z.string(),
  name: z.string(),
  burn: z.array(sprintBurnPointSchema),
  summary: sprintMeasureSummarySchema,
  coverage: analyticsCoverageSchema,
});

const sprintDetailSchema = z.object({
  sprint: sprintSummarySchema,
  measure: z.enum(['issues', 'points']),
  summary: sprintMeasureSummarySchema,
  baseline: z
    .object({
      date: calendarDateSchema,
      scope: numberSchema,
      retroactive: z.boolean(),
    })
    .nullable(),
  counterpart: sprintMeasureSummarySchema,
  scopeChanges: z.object({ added: numberSchema, removed: numberSchema }),
  burn: z.array(sprintBurnPointSchema),
  cohorts: z.object({
    planned: z.array(z.string()),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    completed: z.array(z.string()),
    incomplete: z.array(z.string()),
    carryover: z.array(z.string()),
  }),
  teams: z.array(z.object({ id: z.string(), summary: sprintMeasureSummarySchema })),
  people: z.array(personSprintBurnSchema),
  flow: sprintFlowSchema,
  coverage: analyticsCoverageSchema,
});

export const analyticsSprintsResponseSchema = z.object({
  lens: z.literal('sprints'),
  selected: sprintSummarySchema.nullable(),
  current: sprintDetailSchema.nullable(),
  previous: sprintDetailSchema.nullable(),
  velocity: z.array(
    z.object({
      sprint: sprintSummarySchema,
      planned: numberSchema,
      completed: numberSchema,
      carryover: numberSchema,
      coverage: analyticsCoverageSchema.shape.kind,
    }),
  ),
  flow: sprintFlowSchema,
  focus: personSprintBurnSchema.nullable(),
  coverage: analyticsCoverageSchema,
  formulas: z.object({
    planned: z.string(),
    scope: z.string(),
    burn: z.string(),
    leadTime: z.string(),
    cycleTime: z.string(),
    points: z.string(),
    coverage: z.string(),
  }),
});

const projectCohortsSchema = z.object({
  current: analyticsDrilldownCohortSchema,
  open: analyticsDrilldownCohortSchema,
  completed: analyticsDrilldownCohortSchema,
  blocked: analyticsDrilldownCohortSchema,
  overdue: analyticsDrilldownCohortSchema,
  stale: analyticsDrilldownCohortSchema,
  unestimated: analyticsDrilldownCohortSchema,
  scopeAdded: analyticsDrilldownCohortSchema,
  completedInRange: analyticsDrilldownCohortSchema,
});

const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(PROJECT_STATUSES),
  health: z.enum(PROJECT_HEALTHS),
  healthSource: z.literal('manual'),
  archived: z.boolean(),
  lead: z.object({ id: z.string(), name: z.string() }).nullable(),
  teams: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })),
  startDate: nullableCalendarDateSchema,
  targetDate: nullableCalendarDateSchema,
  scopeIssues: numberSchema,
  scopePoints: numberSchema,
  openIssues: numberSchema,
  openPoints: numberSchema,
  wipIssues: numberSchema,
  wipPoints: numberSchema,
  completedIssues: numberSchema,
  completedPoints: numberSchema,
  blocked: numberSchema,
  overdue: numberSchema,
  stale: numberSchema,
  unestimated: numberSchema,
  scopeAddedIssues: numberSchema,
  scopeAddedPoints: numberSchema,
  scopeAddedCoverage: z.enum(['captured', 'current_project', 'mixed']),
  completedInRangeIssues: numberSchema,
  completedInRangePoints: numberSchema,
  estimateCoverage: z.enum(['none', 'mixed', 'complete']),
  nextMilestoneId: z.string().nullable(),
  nextMilestoneName: z.string().nullable(),
  nextMilestoneTargetDate: nullableCalendarDateSchema,
  cohorts: projectCohortsSchema,
});

const projectDeliverySchema = z.object({
  date: calendarDateSchema,
  scope: numberSchema,
  started: numberSchema,
  completed: numberSchema,
  open: numberSchema,
  added: numberSchema,
  completedInBucket: numberSchema,
  scopeCohort: analyticsDrilldownCohortSchema,
  startedCohort: analyticsDrilldownCohortSchema,
  completedCohort: analyticsDrilldownCohortSchema,
  openCohort: analyticsDrilldownCohortSchema,
  addedCohort: analyticsDrilldownCohortSchema,
  completedInBucketCohort: analyticsDrilldownCohortSchema,
});

export const analyticsProjectsResponseSchema = z.object({
  lens: z.literal('projects'),
  asOf: dateTimeSchema,
  projects: z.array(projectRowSchema),
  totalProjects: z.number().int().nonnegative(),
  truncated: z.boolean(),
  focused: z
    .object({
      project: projectRowSchema,
      delivery: z.array(projectDeliverySchema),
      milestones: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          targetDate: nullableCalendarDateSchema,
          scopeIssues: numberSchema,
          scopePoints: numberSchema,
          completedIssues: numberSchema,
          completedPoints: numberSchema,
          progressIssues: numberSchema.nullable(),
          progressPoints: numberSchema.nullable(),
          currentCohort: analyticsDrilldownCohortSchema,
          completedCohort: analyticsDrilldownCohortSchema,
        }),
      ),
      totalMilestones: z.number().int().nonnegative(),
      milestonesTruncated: z.boolean(),
      healthUpdates: z.array(
        z.object({
          id: z.string(),
          health: z.enum(PROJECT_HEALTHS),
          body: z.string(),
          createdAt: dateTimeSchema,
          author: z.object({ id: z.string(), name: z.string() }),
        }),
      ),
    })
    .nullable(),
  coverage: analyticsCoverageSchema,
});

const personDistributionSchema = z.object({
  valid: z.number().int().nonnegative(),
  p50: numberSchema.nullable(),
  p85: numberSchema.nullable(),
});

const personCohortsSchema = z.object({
  currentAssignments: analyticsDrilldownCohortSchema,
  completed: analyticsDrilldownCohortSchema,
  wip: analyticsDrilldownCohortSchema,
  blocked: analyticsDrilldownCohortSchema,
  overdue: analyticsDrilldownCohortSchema,
  stale: analyticsDrilldownCohortSchema,
  unestimated: analyticsDrilldownCohortSchema,
});

const personRowSchema = z.object({
  person: z.object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    currentMember: z.boolean(),
    status: z.enum(['current', 'former', 'deleted', 'unassigned']),
  }),
  currentAssignments: numberSchema,
  currentPoints: numberSchema,
  completedIssues: numberSchema,
  completedPoints: numberSchema,
  activeWeeks: numberSchema,
  averageThroughputIssues: numberSchema,
  averageThroughputPoints: numberSchema,
  cycleTime: personDistributionSchema,
  leadTime: personDistributionSchema,
  currentWip: numberSchema,
  currentWipPoints: numberSchema,
  wipAge: personDistributionSchema,
  blocked: numberSchema,
  overdue: numberSchema,
  stale: numberSchema,
  unestimated: numberSchema,
  currentProjects: numberSchema,
  currentMilestones: numberSchema,
  currentSprints: numberSchema,
  attribution: z.object({
    captured: numberSchema,
    reconstructed: numberSchema,
    currentAssignee: numberSchema,
    kind: z.enum(['captured', 'reconstructed', 'current_assignee', 'mixed', 'unavailable']),
  }),
  cohorts: personCohortsSchema,
});

const personWorkGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  issues: numberSchema,
  points: numberSchema,
  cohort: analyticsDrilldownCohortSchema,
});

const personDetailSchema = personRowSchema.extend({
  projects: z.array(personWorkGroupSchema),
  milestones: z.array(personWorkGroupSchema),
  sprints: z.array(personWorkGroupSchema),
  states: z.array(personWorkGroupSchema),
  timeline: z.array(
    z.object({
      date: calendarDateSchema,
      assignedIssues: numberSchema,
      assignedPoints: numberSchema,
      completedIssues: numberSchema,
      completedPoints: numberSchema,
      assignedCohort: analyticsDrilldownCohortSchema,
      completedCohort: analyticsDrilldownCohortSchema,
    }),
  ),
  sprintBurn: z.object({
    selected: sprintSummarySchema.nullable(),
    current: personSprintBurnSchema.nullable(),
    previous: personSprintBurnSchema.nullable(),
  }),
});

export const analyticsPeopleResponseSchema = z.object({
  lens: z.literal('people'),
  asOf: dateTimeSchema,
  people: z.array(personRowSchema),
  totalPeople: z.number().int().nonnegative(),
  truncated: z.boolean(),
  focused: personDetailSchema.nullable(),
  coverage: analyticsCoverageSchema,
  formulas: z.object({
    currentAssignments: z.string(),
    completed: z.string(),
    activeWeek: z.string(),
    cycleTime: z.string(),
    leadTime: z.string(),
    wipAge: z.string(),
    attribution: z.string(),
    points: z.string(),
  }),
});

export const analyticsDrilldownResponseSchema = z.object({
  predicate: z.string(),
  total: z.number().int().nonnegative(),
  totalValue: numberSchema,
  details: z.object({
    validCycleCount: z.number().int().nonnegative(),
    cycleTimeP50: numberSchema.nullable(),
    cycleTimeP85: numberSchema.nullable(),
  }),
  issues: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      priority: z.number().int(),
      estimate: numberSchema.nullable(),
      dueDate: nullableCalendarDateSchema,
      updatedAt: dateTimeSchema,
      completedAt: nullableDateTimeSchema,
      cycleTimeDays: numberSchema.nullable(),
      state: z.object({ id: z.string(), name: z.string(), category: z.string() }),
      project: z.object({ id: z.string(), name: z.string() }).nullable(),
      assignee: z
        .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
        .nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
  limit: z.number().int().min(1).max(200),
  asOf: dateTimeSchema,
  from: dateTimeSchema,
  to: dateTimeSchema,
  timezone: z.string().min(1),
});

export const analyticsLensResponseSchemas = {
  overview: analyticsOverviewResponseSchema,
  sprints: analyticsSprintsResponseSchema,
  projects: analyticsProjectsResponseSchema,
  people: analyticsPeopleResponseSchema,
} as const;

export const analyticsLensResponseSchema = z.discriminatedUnion('lens', [
  analyticsOverviewResponseSchema,
  analyticsSprintsResponseSchema,
  analyticsProjectsResponseSchema,
  analyticsPeopleResponseSchema,
]);

export type AnalyticsOverviewResponse = z.infer<typeof analyticsOverviewResponseSchema>;
export type AnalyticsSprintsResponse = z.infer<typeof analyticsSprintsResponseSchema>;
export type AnalyticsProjectsResponse = z.infer<typeof analyticsProjectsResponseSchema>;
export type AnalyticsPeopleResponse = z.infer<typeof analyticsPeopleResponseSchema>;
export type AnalyticsDrilldownResponse = z.infer<typeof analyticsDrilldownResponseSchema>;

export interface AnalyticsResponseByLens {
  readonly overview: AnalyticsOverviewResponse;
  readonly sprints: AnalyticsSprintsResponse;
  readonly projects: AnalyticsProjectsResponse;
  readonly people: AnalyticsPeopleResponse;
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function analyticsWireResponse(lens: 'overview', value: unknown): AnalyticsOverviewResponse;
export function analyticsWireResponse(lens: 'sprints', value: unknown): AnalyticsSprintsResponse;
export function analyticsWireResponse(lens: 'projects', value: unknown): AnalyticsProjectsResponse;
export function analyticsWireResponse(lens: 'people', value: unknown): AnalyticsPeopleResponse;
export function analyticsWireResponse(
  lens: keyof AnalyticsResponseByLens,
  value: unknown,
): AnalyticsResponseByLens[keyof AnalyticsResponseByLens] {
  const wire = jsonValue(value);
  switch (lens) {
    case 'overview':
      return analyticsOverviewResponseSchema.parse(wire);
    case 'sprints':
      return analyticsSprintsResponseSchema.parse(wire);
    case 'projects':
      return analyticsProjectsResponseSchema.parse(wire);
    case 'people':
      return analyticsPeopleResponseSchema.parse(wire);
  }
}

export function analyticsDrilldownWireResponse(value: unknown): AnalyticsDrilldownResponse {
  return analyticsDrilldownResponseSchema.parse(jsonValue(value));
}

const insightSegmentValueSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: numberSchema,
});

const insightBucketSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: numberSchema,
  segments: z.array(insightSegmentValueSchema),
  cohort: analyticsDrilldownCohortSchema.nullable(),
});

const insightPercentilesSchema = z.object({
  p25: numberSchema,
  p50: numberSchema,
  p75: numberSchema,
  p95: numberSchema,
});

const insightScatterPointSchema = z.object({
  issueId: z.string(),
  identifier: z.string(),
  title: z.string(),
  days: numberSchema,
});

export const analyticsInsightsWireResponse = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('bars'),
    unit: z.enum(['issues', 'points']),
    buckets: z.array(insightBucketSchema),
  }),
  z.object({
    kind: z.literal('scatter'),
    unit: z.literal('days'),
    points: z.array(insightScatterPointSchema),
    percentiles: insightPercentilesSchema.nullable(),
  }),
]);

export type AnalyticsInsightsResponse = z.infer<typeof analyticsInsightsWireResponse>;
