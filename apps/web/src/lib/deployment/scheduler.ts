const MINUTE = 60_000;

export const maintenanceJobs = [
  { path: '/api/cron/notifications', interval: MINUTE, offset: 0 },
  { path: '/api/cron/sprint-rollover', interval: MINUTE, offset: 0 },
  { path: '/api/cron/analytics-snapshots', interval: 360 * MINUTE, offset: 0 },
  { path: '/api/cron/prune', interval: 1_440 * MINUTE, offset: 240 * MINUTE },
] as const;

export function createMaintenanceScheduler(
  run: (path: string) => Promise<void>,
  startedAt: number = Date.now(),
) {
  const slots = new Map(
    maintenanceJobs.map((job) => [job.path, Math.floor((startedAt - job.offset) / job.interval)]),
  );
  const active = new Map<string, Promise<void>>();

  async function tick(now: number = Date.now()): Promise<void> {
    const started: Promise<void>[] = [];
    for (const job of maintenanceJobs) {
      const slot = Math.floor((now - job.offset) / job.interval);
      if (slot <= (slots.get(job.path) ?? slot) || active.has(job.path)) continue;
      slots.set(job.path, slot);
      const pending = Promise.resolve()
        .then(() => run(job.path))
        .finally(() => active.delete(job.path));
      active.set(job.path, pending);
      started.push(pending);
    }
    await Promise.allSettled(started);
  }

  return { tick, drain: async () => await Promise.allSettled(active.values()) };
}
