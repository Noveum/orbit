export interface IssueTimestamps {
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface ProgressPoint {
  readonly date: string;
  readonly scope: number;
  readonly completed: number;
}

export const DEFAULT_SERIES_POINTS = 12;

function isoDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function buildProjectSeries(
  issues: readonly IssueTimestamps[],
  now: Date,
  pointCount: number = DEFAULT_SERIES_POINTS,
): ProgressPoint[] {
  if (issues.length === 0) return [];
  const start = Math.min(...issues.map((issue) => issue.createdAt.getTime()));
  const end = Math.max(start, now.getTime());
  const steps = Math.max(2, pointCount);
  const stride = (end - start) / (steps - 1);

  const points: ProgressPoint[] = [];
  for (let index = 0; index < steps; index += 1) {
    const cutoff = index === steps - 1 ? end : start + stride * index;
    points.push({
      date: isoDay(cutoff),
      scope: issues.filter((issue) => issue.createdAt.getTime() <= cutoff).length,
      completed: issues.filter(
        (issue) => issue.completedAt !== null && issue.completedAt.getTime() <= cutoff,
      ).length,
    });
  }
  return points;
}
