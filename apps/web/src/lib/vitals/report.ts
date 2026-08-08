import { routePattern, type WebVitalInput } from '@orbit/shared/validators';

const ENDPOINT = '/api/vitals';

export const INP_DURATION_THRESHOLD = 16;

export function queueLimit(): number {
  return 20;
}

export function sendReport(vitals: readonly WebVitalInput[]): void {
  if (vitals.length === 0) return;
  const body = JSON.stringify({ vitals });

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon(ENDPOINT, blob)) return;
  }

  fetch(ENDPOINT, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
    keepalive: true,
  }).catch(() => undefined);
}

interface MetricLike {
  readonly name: string;
  readonly value: number;
  readonly rating: string;
  readonly navigationType?: string;
  readonly attribution?: unknown;
}

function textField(source: unknown, field: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const held = (source as Record<string, unknown>)[field];
  return typeof held === 'string' && held.length > 0 ? held : undefined;
}

const TRACKED = new Set(['CLS', 'INP', 'LCP', 'TTFB']);
const RATINGS = new Set(['good', 'needs-improvement', 'poor']);
const INTERACTIONS = new Set(['pointer', 'keyboard']);

export function toReport(metric: MetricLike, pathname: string): WebVitalInput | null {
  if (!TRACKED.has(metric.name)) return null;
  if (!RATINGS.has(metric.rating)) return null;
  if (!Number.isFinite(metric.value) || metric.value < 0) return null;

  const interaction = textField(metric.attribution, 'interactionType');
  const target = textField(metric.attribution, 'interactionTarget');

  return {
    route: routePattern(pathname),
    metric: metric.name as WebVitalInput['metric'],
    value: Math.round(metric.value * 1000) / 1000,
    rating: metric.rating as WebVitalInput['rating'],
    navigationType: metric.navigationType ?? '',
    ...(interaction !== undefined && INTERACTIONS.has(interaction)
      ? { interactionType: interaction as 'pointer' | 'keyboard' }
      : {}),
    ...(target !== undefined && target.length > 0 ? { target: target.slice(0, 256) } : {}),
  };
}
