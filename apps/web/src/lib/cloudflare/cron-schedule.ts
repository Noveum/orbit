export const CRON_SCHEDULE: Readonly<Record<string, readonly string[]>> = {
  '* * * * *': ['/api/cron/notifications', '/api/cron/sprint-rollover'],
  '0 * * * *': ['/api/cron/prune'],
  '0 */6 * * *': ['/api/cron/analytics-snapshots'],
  '0 9 * * *': ['/api/cron/project-staleness'],
};

export interface CronOutcome {
  readonly path: string;
  readonly status: number;
}

export type CronDispatch = (request: Request) => Promise<Response>;

export function cronPaths(expression: string): readonly string[] {
  return CRON_SCHEDULE[expression] ?? [];
}

export async function runCronJobs(
  expression: string,
  origin: string,
  secret: string,
  dispatch: CronDispatch,
): Promise<CronOutcome[]> {
  const paths = cronPaths(expression);
  if (paths.length === 0) throw new Error(`No cron job is scheduled for "${expression}".`);
  if (secret.length === 0) throw new Error('CRON_SECRET is required to run scheduled jobs.');
  const settled = await Promise.allSettled(
    paths.map(async (path): Promise<CronOutcome> => {
      const response = await dispatch(
        new Request(new URL(path, origin), { headers: { authorization: `Bearer ${secret}` } }),
      );
      await response.body?.cancel();
      return { path, status: response.status };
    }),
  );
  const outcomes: CronOutcome[] = [];
  const failures: string[] = [];
  settled.forEach((result, index) => {
    const path = paths[index] ?? '';
    if (result.status === 'rejected') {
      failures.push(`${path} threw ${String(result.reason)}`);
      return;
    }
    outcomes.push(result.value);
    if (result.value.status >= 400) failures.push(`${path} answered ${result.value.status}`);
  });
  if (failures.length > 0) throw new Error(`Scheduled jobs failed: ${failures.join('; ')}`);
  return outcomes;
}
