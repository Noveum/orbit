import { describe, expect, it } from 'bun:test';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import {
  assertProductionAuthenticationConfigured,
  assertProductionStartupAuthenticationConfigured,
} from '@/lib/env';
import nextConfig from '../../next.config.ts';

const productionEnvironment = {
  NODE_ENV: 'production',
};

const authenticationVariables = [
  'ORBIT_PASSWORD_AUTH',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
] as const;

function withoutAuthentication(run: () => void): void {
  const originalValues = authenticationVariables.map((name) => [name, process.env[name]] as const);

  try {
    for (const name of authenticationVariables) delete process.env[name];
    run();
  } finally {
    for (const [name, value] of originalValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe('production authentication configuration', () => {
  it('rejects a deployment with no first-login path', () => {
    expect(() => assertProductionAuthenticationConfigured(productionEnvironment)).toThrow(
      'ORBIT_PASSWORD_AUTH',
    );
  });

  it('treats standalone startup as production before Next initializes its server', () => {
    expect(() => assertProductionStartupAuthenticationConfigured({})).toThrow(
      'Production requires a usable first-login method.',
    );
  });

  it.each(['development', 'test'])('does not constrain %s startup', (nodeEnvironment) => {
    expect(() =>
      assertProductionAuthenticationConfigured({ NODE_ENV: nodeEnvironment }),
    ).not.toThrow();
  });

  it.each(['true', '1'])('accepts password authentication set to %s', (value) => {
    expect(() =>
      assertProductionAuthenticationConfigured({
        ...productionEnvironment,
        ORBIT_PASSWORD_AUTH: value,
      }),
    ).not.toThrow();
  });

  it.each([
    {
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    },
    {
      GITHUB_CLIENT_ID: 'github-client',
      GITHUB_CLIENT_SECRET: 'github-secret',
    },
    {
      RESEND_API_KEY: 'resend-secret',
      EMAIL_FROM: 'Orbit <orbit@example.com>',
    },
  ])('accepts a complete external authentication path', (configuration) => {
    expect(() =>
      assertProductionAuthenticationConfigured({
        ...productionEnvironment,
        ...configuration,
      }),
    ).not.toThrow();
  });

  it.each([
    { GOOGLE_CLIENT_ID: 'google-client' },
    { GOOGLE_CLIENT_SECRET: 'google-secret' },
    { GITHUB_CLIENT_ID: 'github-client' },
    { GITHUB_CLIENT_SECRET: 'github-secret' },
    { RESEND_API_KEY: 'resend-secret' },
    { RESEND_API_KEY: 'resend-secret', EMAIL_FROM: 'Orbit <auth@orbit.local>' },
    { RESEND_API_KEY: 'resend-secret', EMAIL_FROM: 'Orbit <auth@orbit.local >' },
    { RESEND_API_KEY: 'resend-secret', EMAIL_FROM: 'Orbit <auth@sub.orbit.local>' },
    { RESEND_API_KEY: 'resend-secret', EMAIL_FROM: 'auth@example.local' },
    { RESEND_API_KEY: 'resend-secret', EMAIL_FROM: 'not-an-email' },
    { RESEND_API_KEY: 'resend-secret', EMAIL_FROM: '  ' },
    { GOOGLE_CLIENT_ID: ' ', GOOGLE_CLIENT_SECRET: 'google-secret' },
    { ORBIT_DEV_LOGIN: '1' },
  ])('rejects an incomplete production path', (configuration) => {
    expect(() =>
      assertProductionAuthenticationConfigured({
        ...productionEnvironment,
        ...configuration,
      }),
    ).toThrow();
  });

  it('names supported variables without revealing configured values', () => {
    const suppliedValues = ['google-client-private', 'resend-private'];
    let message = '';

    try {
      assertProductionAuthenticationConfigured({
        ...productionEnvironment,
        GOOGLE_CLIENT_ID: suppliedValues[0],
        RESEND_API_KEY: suppliedValues[1],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('ORBIT_PASSWORD_AUTH');
    expect(message).toContain('GOOGLE_CLIENT_ID');
    expect(message).toContain('GOOGLE_CLIENT_SECRET');
    expect(message).toContain('GITHUB_CLIENT_ID');
    expect(message).toContain('GITHUB_CLIENT_SECRET');
    expect(message).toContain('RESEND_API_KEY');
    expect(message).toContain('EMAIL_FROM');
    for (const value of suppliedValues) expect(message).not.toContain(value);
  });

  it('stops a production build with no first-login path', () => {
    withoutAuthentication(() => {
      expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).toThrow(
        'Production requires a usable first-login method.',
      );
    });
  });

  it('leaves development config available without a first-login path', () => {
    withoutAuthentication(() => {
      expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).not.toThrow();
    });
  });
});
