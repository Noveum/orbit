import { describe, expect, it, mock } from 'bun:test';
import { createMaintenanceScheduler } from '@/lib/deployment/scheduler.ts';

describe('self-hosted maintenance scheduler', () => {
  it('runs minute jobs once per UTC minute without duplicating repeated ticks', async () => {
    const run = mock(async (_path: string) => undefined);
    const start = Date.parse('2026-09-23T02:30:20Z');
    const scheduler = createMaintenanceScheduler(run, start);
    await scheduler.tick(start + 39_000);
    expect(run).not.toHaveBeenCalled();
    await scheduler.tick(start + 40_000);
    await scheduler.tick(start + 41_000);
    expect(run.mock.calls.map(([path]) => path)).toEqual([
      '/api/cron/notifications',
      '/api/cron/sprint-rollover',
    ]);
  });

  it('runs snapshots every six hours and pruning at 04:00 UTC', async () => {
    const run = mock(async (_path: string) => undefined);
    const scheduler = createMaintenanceScheduler(run, Date.parse('2026-09-23T03:59:00Z'));
    await scheduler.tick(Date.parse('2026-09-23T04:00:00Z'));
    expect(run.mock.calls.map(([path]) => path)).toContain('/api/cron/prune');
    expect(run.mock.calls.map(([path]) => path)).not.toContain('/api/cron/analytics-snapshots');
    run.mockClear();
    await scheduler.tick(Date.parse('2026-09-23T06:00:00Z'));
    expect(run.mock.calls.map(([path]) => path)).toContain('/api/cron/analytics-snapshots');
    expect(run.mock.calls.map(([path]) => path)).not.toContain('/api/cron/prune');
  });

  it('does not overlap jobs and resumes after a request settles', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = mock((_path: string) => pending);
    const scheduler = createMaintenanceScheduler(run, 0);
    const first = scheduler.tick(60_000);
    await Promise.resolve();
    await scheduler.tick(120_000);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await first;
    await scheduler.tick(120_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('keeps future ticks working after a job fails', async () => {
    const run = mock((_path: string) => Promise.reject(new Error('Unavailable')));
    const scheduler = createMaintenanceScheduler(run, 0);
    await scheduler.tick(60_000);
    await scheduler.tick(120_000);
    expect(run).toHaveBeenCalledTimes(4);
    await scheduler.drain();
  });
});
