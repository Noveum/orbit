import { routePattern, type WebVitalInput, type WebVitalParts } from '@orbit/shared/validators';

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
  readonly navigationURL?: string;
  readonly attribution?: unknown;
}

function textField(source: unknown, field: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const held = (source as Record<string, unknown>)[field];
  return typeof held === 'string' && held.length > 0 ? held : undefined;
}

export function pathnameFor(metric: MetricLike, fallback: string): string {
  if (metric.navigationURL === undefined) return fallback;
  try {
    return new URL(metric.navigationURL, 'http://orbit.invalid').pathname;
  } catch {
    return fallback;
  }
}

const PART_FIELDS = [
  'timeToFirstByte',
  'resourceLoadDelay',
  'resourceLoadDuration',
  'elementRenderDelay',
  'inputDelay',
  'processingDuration',
  'presentationDelay',
] as const;

function partsOf(attribution: unknown): WebVitalParts | undefined {
  if (typeof attribution !== 'object' || attribution === null) return undefined;
  const held = attribution as Record<string, unknown>;
  const parts: Record<string, number | string> = {};

  for (const field of PART_FIELDS) {
    const value = held[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      parts[field] = Math.round(value * 100) / 100;
    }
  }
  const loadState = textField(attribution, 'loadState');
  if (loadState !== undefined) parts['loadState'] = loadState.slice(0, 64);

  return Object.keys(parts).length === 0 ? undefined : (parts as WebVitalParts);
}

const TRACKED = new Set(['CLS', 'INP', 'LCP', 'TTFB']);
const RATINGS = new Set(['good', 'needs-improvement', 'poor']);
const INTERACTIONS = new Set(['pointer', 'keyboard']);

export function toReport(metric: MetricLike, pathname: string): WebVitalInput | null {
  if (!TRACKED.has(metric.name)) return null;
  if (!RATINGS.has(metric.rating)) return null;
  if (!Number.isFinite(metric.value) || metric.value < 0) return null;

  const interaction = textField(metric.attribution, 'interactionType');
  const target =
    textField(metric.attribution, 'interactionTarget') ?? textField(metric.attribution, 'target');
  const parts = partsOf(metric.attribution);

  return {
    route: routePattern(pathnameFor(metric, pathname)),
    metric: metric.name as WebVitalInput['metric'],
    value: Math.round(metric.value * 1000) / 1000,
    rating: metric.rating as WebVitalInput['rating'],
    navigationType: metric.navigationType ?? '',
    ...(interaction !== undefined && INTERACTIONS.has(interaction)
      ? { interactionType: interaction as 'pointer' | 'keyboard' }
      : {}),
    ...(target !== undefined && target.length > 0 ? { target: target.slice(0, 256) } : {}),
    ...(parts === undefined ? {} : { parts }),
  };
}
