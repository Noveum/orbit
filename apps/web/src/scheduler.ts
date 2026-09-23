import { createMaintenanceScheduler } from './lib/deployment/scheduler.ts';

const secret = process.env['CRON_SECRET'];
if (secret === undefined || secret.trim().length === 0) {
  throw new Error('CRON_SECRET is required for scheduled maintenance.');
}
const origin = process.env['ORBIT_INTERNAL_URL'] ?? 'http://web:3000';
const scheduler = createMaintenanceScheduler(async (path) => {
  try {
    const response = await fetch(new URL(path, origin), {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(300_000),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.info(JSON.stringify({ job: path, status: 'ok' }));
  } catch {
    console.error(JSON.stringify({ job: path, status: 'failed' }));
  }
});
const timer = setInterval(() => scheduler.tick(), 1_000);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    scheduler.drain();
  });
}
