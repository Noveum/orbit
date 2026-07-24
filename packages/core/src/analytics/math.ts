export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0] ?? 0;
  const clamped = Math.min(1, Math.max(0, quantile));
  const position = clamped * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

export interface Distribution {
  readonly count: number;
  readonly p50: number;
  readonly p85: number;
  readonly min: number;
  readonly max: number;
  readonly average: number;
}

export function distributionOf(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p85: percentile(values, 0.85),
    min: Math.min(...values),
    max: Math.max(...values),
    average: total / values.length,
  };
}

export function idealRemaining(scope: number, dayIndex: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  const daysLeft = Math.max(0, totalDays - dayIndex);
  return (scope * daysLeft) / totalDays;
}

export interface ChurnTotals {
  readonly added: number;
  readonly removed: number;
}

export function churnFromScopeSeries(scopeByDay: readonly number[]): ChurnTotals {
  let added = 0;
  let removed = 0;
  for (let index = 1; index < scopeByDay.length; index += 1) {
    const previous = scopeByDay[index - 1] ?? 0;
    const current = scopeByDay[index] ?? 0;
    const delta = current - previous;
    if (delta > 0) added += delta;
    else if (delta < 0) removed += -delta;
  }
  return { added, removed };
}
