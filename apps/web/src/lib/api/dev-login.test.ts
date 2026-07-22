import { afterEach, describe, expect, it, vi } from 'vitest';
import { devLoginEnabled } from './dev-login.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('devLoginEnabled', () => {
  it('stays off unless the flag is explicitly set to 1', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ORBIT_DEV_LOGIN', '');
    expect(devLoginEnabled()).toBe(false);

    vi.stubEnv('ORBIT_DEV_LOGIN', 'true');
    expect(devLoginEnabled()).toBe(false);

    vi.stubEnv('ORBIT_DEV_LOGIN', '1');
    expect(devLoginEnabled()).toBe(true);
  });

  it('stays off in production even when the flag is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ORBIT_DEV_LOGIN', '1');
    expect(devLoginEnabled()).toBe(false);
  });
});
