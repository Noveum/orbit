import { describe, expect, it } from 'bun:test';
import { getRecoveryState, setRecoveryState } from '@orbit/services/backup/readiness';
import { resolveTestDatabaseUrl } from '../../../../../../scripts/test-env.ts';
import { GET } from '../../../../src/app/api/health/route.ts';

async function isDatabaseReachable(url: string): Promise<boolean> {
  try {
    await getRecoveryState(url);
    return true;
  } catch {
    return false;
  }
}

describe('/api/health route', () => {
  it('returns 200 ok when database is ready or unconfigured', async () => {
    const origUrl = process.env['DATABASE_URL'];
    try {
      delete process.env['DATABASE_URL'];
      const response = await GET();
      expect(response.status).toBe(200);
      const json = (await response.json()) as { status: string; service: string };
      expect(json.status).toBe('ok');
      expect(json.service).toBe('web');
    } finally {
      if (origUrl === undefined) {
        delete process.env['DATABASE_URL'];
      } else {
        process.env['DATABASE_URL'] = origUrl;
      }
    }
  });

  it('returns 503 unready when target is in restoring or validation_failed state', async () => {
    const databaseUrl = process.env['DATABASE_URL'] ?? resolveTestDatabaseUrl('orbit_test_web');
    const reachable = await isDatabaseReachable(databaseUrl);
    if (!reachable) return;

    const origUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = databaseUrl;

    try {
      await setRecoveryState(databaseUrl, 'restoring');
      let response = await GET();
      expect(response.status).toBe(503);
      let json = (await response.json()) as { status: string; recovery?: string };
      expect(json.status).toBe('unready');
      expect(json.recovery).toBe('restoring');

      await setRecoveryState(
        databaseUrl,
        'validation_failed',
        'referential integrity check failed',
      );
      response = await GET();
      expect(response.status).toBe(503);
      json = (await response.json()) as { status: string; recovery?: string };
      expect(json.status).toBe('unready');
      expect(json.recovery).toBe('validation_failed');

      await setRecoveryState(databaseUrl, 'ready');
      response = await GET();
      expect(response.status).toBe(200);
      const okJson = (await response.json()) as { status: string };
      expect(okJson.status).toBe('ok');
    } finally {
      if (origUrl === undefined) {
        delete process.env['DATABASE_URL'];
      } else {
        process.env['DATABASE_URL'] = origUrl;
      }
    }
  });

  it('returns 200 ok when database connection fails', async () => {
    const origUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = 'postgres://orbit:orbit@localhost:59999/down_db';

    try {
      const response = await GET();
      expect(response.status).toBe(200);
      const json = (await response.json()) as { status: string };
      expect(json.status).toBe('ok');
    } finally {
      if (origUrl === undefined) {
        delete process.env['DATABASE_URL'];
      } else {
        process.env['DATABASE_URL'] = origUrl;
      }
    }
  });
});
