import { describe, expect, it } from 'bun:test';
import type { Principal } from '@orbit/shared/policy';
import { deploymentStatus } from '@/features/settings/deployment-status.ts';

const admin: Principal = { userId: 'user', organizationId: 'org', role: 'admin', teamIds: [] };

describe('deploymentStatus', () => {
  it.each(['member', 'contributor', 'guest'] as const)(
    'refuses configuration access for %s',
    (role) => {
      expect(() => deploymentStatus({ ...admin, role }, {})).toThrow(
        'Your role cannot org manage.',
      );
    },
  );

  it('reports the actual limits of a password-only HTTP deployment', () => {
    const checks = deploymentStatus(admin, { ORBIT_PASSWORD_AUTH: 'true' });
    expect(checks.find((check) => check.id === 'authentication')?.status).toBe('Configured');
    expect(checks.find((check) => check.id === 'email')?.status).toBe('Needs configuration');
    expect(checks.find((check) => check.id === 'realtime')?.status).toBe('Unavailable');
    expect(checks.find((check) => check.id === 'schedules')?.status).toBe('Needs configuration');
    expect(checks.find((check) => check.id === 'registration')?.description).toContain(
      'Registration is open',
    );
  });

  it('requires runtime verification for Docker realtime and maintenance', () => {
    const checks = deploymentStatus(admin, {
      ORBIT_SELF_HOSTED: 'true',
      CRON_SECRET: 'private-cron',
    });
    expect(checks.find((check) => check.id === 'realtime')?.status).toBe('Requires verification');
    expect(checks.find((check) => check.id === 'realtime')?.description).toContain(
      'Docker gateway',
    );
    expect(checks.find((check) => check.id === 'schedules')?.status).toBe('Requires verification');
  });

  it('does not claim delivery, live updates or scheduling have been tested', () => {
    const checks = deploymentStatus(admin, {
      RESEND_API_KEY: 'private-resend',
      EMAIL_FROM: 'Orbit <orbit@example.com>',
      VERCEL: '1',
      CRON_SECRET: 'private-cron',
      ALLOWED_EMAIL_DOMAINS: 'private.example.com',
    });
    expect(checks.find((check) => check.id === 'email')?.status).toBe('Configured');
    expect(checks.find((check) => check.id === 'email')?.description).toContain(
      'does not confirm delivery',
    );
    expect(checks.find((check) => check.id === 'realtime')?.status).toBe('Requires verification');
    expect(checks.find((check) => check.id === 'schedules')?.status).toBe('Requires verification');
    const serialized = JSON.stringify(checks);
    expect(serialized).not.toContain('private-resend');
    expect(serialized).not.toContain('private-cron');
    expect(serialized).not.toContain('private.example.com');
  });

  it('keeps GitHub sign-in distinct from the GitHub App integration', () => {
    const checks = deploymentStatus(admin, {
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
    });
    expect(checks.find((check) => check.id === 'authentication')?.status).toBe('Configured');
    expect(checks.find((check) => check.id === 'github')?.status).toBe('Needs configuration');
  });
});
