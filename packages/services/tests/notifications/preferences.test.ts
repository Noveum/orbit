import { afterEach, describe, expect, it } from 'bun:test';
import { defaultPreferences } from '../../src/notifications/preferences.ts';

const previousSlackEnabled = process.env['SLACK_ENABLED'];

afterEach(() => {
  if (previousSlackEnabled === undefined) delete process.env['SLACK_ENABLED'];
  else process.env['SLACK_ENABLED'] = previousSlackEnabled;
});

describe('defaultPreferences Slack rollout', () => {
  it('disables Slack defaults when the global flag is off', () => {
    process.env['SLACK_ENABLED'] = 'false';

    expect(
      defaultPreferences()
        .filter((preference) => preference.channel === 'slack' || preference.channel === 'slack_dm')
        .every((preference) => !preference.enabled),
    ).toBe(true);
  });

  it('enables Slack defaults when the global flag is on', () => {
    process.env['SLACK_ENABLED'] = 'true';

    expect(
      defaultPreferences()
        .filter((preference) => preference.channel === 'slack' || preference.channel === 'slack_dm')
        .every((preference) => preference.enabled),
    ).toBe(true);
  });
});
