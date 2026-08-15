const runtimeProcess = (
  globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }
).process;

export const SLACK_INTEGRATION_ENABLED = runtimeProcess?.env?.['ORBIT_SLACK_ENABLED'] === '1';
