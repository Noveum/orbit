import { z } from 'zod';

export const WEB_VITAL_METRICS = ['CLS', 'INP', 'LCP', 'TTFB'] as const;
export type WebVitalMetric = (typeof WEB_VITAL_METRICS)[number];

export const WEB_VITAL_RATINGS = ['good', 'needs-improvement', 'poor'] as const;

const ISSUE_IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$/i;
const NUMERIC = /^\d+$/;
const OPAQUE_ID = /^[a-z]+_[A-Za-z0-9_-]{8,}$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NAMED_PARENT: Readonly<Record<string, string>> = {
  issue: '[identifier]',
  team: '[key]',
  doc: '[id]',
  docs: '[id]',
  projects: '[slug]',
  views: '[id]',
  sprint: '[number]',
  workspaces: '[slug]',
};

function looksLikeAnIdentifier(segment: string): boolean {
  if (NUMERIC.test(segment)) return true;
  if (UUID_LIKE.test(segment)) return true;
  if (OPAQUE_ID.test(segment)) return true;
  return ISSUE_IDENTIFIER.test(segment) && /\d/.test(segment);
}

export function routePattern(pathname: string): string {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return '/';

  const patterned = segments.map((segment, at) => {
    const parent = at === 0 ? '' : (segments[at - 1] ?? '');
    const named = NAMED_PARENT[parent];
    if (named !== undefined && at > 0) return named;
    return looksLikeAnIdentifier(segment) ? '[id]' : segment;
  });

  return `/${patterned.join('/')}`;
}

const duration = z.number().finite().nonnegative().max(3_600_000);

export const webVitalPartsSchema = z
  .object({
    timeToFirstByte: duration,
    resourceLoadDelay: duration,
    resourceLoadDuration: duration,
    elementRenderDelay: duration,
    inputDelay: duration,
    processingDuration: duration,
    presentationDelay: duration,
    loadState: z.string().max(64),
  })
  .partial();

export type WebVitalParts = z.infer<typeof webVitalPartsSchema>;

export const webVitalSchema = z.object({
  route: z.string().min(1).max(256),
  metric: z.enum(WEB_VITAL_METRICS),
  value: z.number().finite().nonnegative().max(3_600_000),
  rating: z.enum(WEB_VITAL_RATINGS),
  navigationType: z.string().max(32).default(''),
  interactionType: z.enum(['pointer', 'keyboard']).nullish(),
  target: z.string().max(256).nullish(),
  parts: webVitalPartsSchema.nullish(),
});

export type WebVitalInput = z.infer<typeof webVitalSchema>;
