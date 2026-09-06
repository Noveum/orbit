import { afterEach, describe, expect, it } from 'bun:test';
import {
  slackIntegrationEnabled,
  slackIntegrationEnabledForOrganization,
  slackRolloutConfigured,
} from '@/lib/integrations/slack-capability.ts';

const previousSlackEnabled = process.env['SLACK_ENABLED'];
const previousLegacyOrganizationId = process.env['SLACK_ENABLED_ORGANIZATION_ID'];

afterEach(() => {
  if (previousSlackEnabled === undefined) {
    delete process.env['SLACK_ENABLED'];
  } else {
    process.env['SLACK_ENABLED'] = previousSlackEnabled;
  }
  if (previousLegacyOrganizationId === undefined) {
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];
  } else {
    process.env['SLACK_ENABLED_ORGANIZATION_ID'] = previousLegacyOrganizationId;
  }
});

describe('Slack capability', () => {
  it('withholds Slack when the global flag is absent', () => {
    delete process.env['SLACK_ENABLED'];
    process.env['SLACK_ENABLED_ORGANIZATION_ID'] = 'org_noveum';

    expect(slackIntegrationEnabled()).toBe(false);
    expect(slackRolloutConfigured()).toBe(false);
    expect(slackIntegrationEnabledForOrganization('org_noveum')).toBe(false);
  });

  it('withholds Slack when the global flag is not true', () => {
    for (const value of ['', ' ', '1', 'yes', 'false']) {
      process.env['SLACK_ENABLED'] = value;
      expect(slackIntegrationEnabled()).toBe(false);
      expect(slackRolloutConfigured()).toBe(false);
      expect(slackIntegrationEnabledForOrganization('org_noveum')).toBe(false);
    }
  });

  it('enables Slack for every organization when the global flag is true', () => {
    process.env['SLACK_ENABLED'] = ' TRUE ';

    expect(slackIntegrationEnabled()).toBe(true);
    expect(slackRolloutConfigured()).toBe(true);
    expect(slackIntegrationEnabledForOrganization('org_noveum')).toBe(true);
    expect(slackIntegrationEnabledForOrganization('org_other')).toBe(true);
  });
});
