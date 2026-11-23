import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  CRON_SCHEDULE,
  cronPaths,
  runCronJobs,
} from '../../../src/lib/cloudflare/cron-schedule.ts';

const triggersSchema = z.object({ crons: z.array(z.string()) });

const wranglerSchema = z.object({
  triggers: triggersSchema,
  env: z.record(z.string(), z.object({ triggers: triggersSchema.optional() })),
});

async function readJsonFile(relative: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
}

describe('the Workers cron schedule', () => {
  it('runs every maintenance job on its schedule', () => {
    expect(CRON_SCHEDULE).toEqual({
      '* * * * *': ['/api/cron/notifications', '/api/cron/sprint-rollover'],
      '0 * * * *': ['/api/cron/prune'],
      '0 */6 * * *': ['/api/cron/analytics-snapshots'],
      '0 9 * * *': ['/api/cron/project-staleness'],
    });
  });

  it('registers a Cron Trigger for every schedule and nothing else', async () => {
    const wrangler = wranglerSchema.parse(await readJsonFile('../../../wrangler.jsonc'));
    const schedules = Object.keys(CRON_SCHEDULE).sort();
    expect([...wrangler.triggers.crons].sort()).toEqual(schedules);
    expect([...(wrangler.env['production']?.triggers?.crons ?? [])].sort()).toEqual(schedules);
  });

  it('knows no paths for an expression that is not scheduled', () => {
    expect(cronPaths('5 5 * * *')).toEqual([]);
  });
});

describe('running scheduled jobs', () => {
  it('sends authenticated jobs directly to the placed service and reports a redirect as failure', async () => {
    const calls: string[] = [];
    const service = {
      fetch(url: string, init: RequestInit): Promise<Response> {
        const request = new Request(url, init);
        calls.push(new URL(request.url).pathname);
        expect(request.method).toBe('GET');
        expect(request.headers.get('authorization')).toBe('Bearer fixture-secret');
        expect(request.redirect).toBe('manual');
        return Promise.resolve(Response.redirect('https://orbit.example/sign-in', 302));
      },
    };
    await expect(
      runCronJobs(
        '0 * * * *',
        'https://orbit.example',
        'fixture-secret',
        () => {
          throw new Error('The placed job fell back to the local handler');
        },
        service,
      ),
    ).rejects.toThrow('/api/cron/prune answered 302');
    expect(calls).toEqual(['/api/cron/prune']);
  });

  it('calls every path of the expression with the cron bearer token', async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const outcomes = await runCronJobs(
      '* * * * *',
      'https://orbit.example',
      'secret',
      (request) => {
        seen.push({ url: request.url, authorization: request.headers.get('authorization') });
        return Promise.resolve(Response.json({ ok: true }));
      },
    );
    expect(seen).toEqual([
      { url: 'https://orbit.example/api/cron/notifications', authorization: 'Bearer secret' },
      { url: 'https://orbit.example/api/cron/sprint-rollover', authorization: 'Bearer secret' },
    ]);
    expect(outcomes).toEqual([
      { path: '/api/cron/notifications', status: 200 },
      { path: '/api/cron/sprint-rollover', status: 200 },
    ]);
  });

  it('fails the invocation when a job answers with an error, after running the others', async () => {
    const called: string[] = [];
    const run = runCronJobs('* * * * *', 'https://orbit.example', 'secret', (request) => {
      const path = new URL(request.url).pathname;
      called.push(path);
      return Promise.resolve(
        new Response(null, { status: path.endsWith('notifications') ? 503 : 200 }),
      );
    });
    await expect(run).rejects.toThrow('/api/cron/notifications answered 503');
    expect(called).toHaveLength(2);
  });

  it('fails the invocation when a job throws', async () => {
    const run = runCronJobs('0 * * * *', 'https://orbit.example', 'secret', () =>
      Promise.reject(new Error('database unreachable')),
    );
    await expect(run).rejects.toThrow('/api/cron/prune threw Error: database unreachable');
  });

  it('refuses an unknown expression and a missing secret', async () => {
    const dispatch = (): Promise<Response> => Promise.resolve(new Response(null));
    await expect(runCronJobs('5 5 * * *', 'https://orbit.example', 's', dispatch)).rejects.toThrow(
      'No cron job is scheduled',
    );
    await expect(runCronJobs('* * * * *', 'https://orbit.example', '', dispatch)).rejects.toThrow(
      'CRON_SECRET is required',
    );
  });
});
