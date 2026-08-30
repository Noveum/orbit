import { afterEach, describe, expect, it } from 'bun:test';
import {
  slackEnabledOrganizationId,
  slackIntegrationEnabledForOrganization,
  slackRolloutConfigured,
} from '@/lib/integrations/slack-capability.ts';

const previousEnabledOrganizationId = process.env['SLACK_ENABLED_ORGANIZATION_ID'];

afterEach(() => {
  if (previousEnabledOrganizationId === undefined) {
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];
  } else {
    process.env['SLACK_ENABLED_ORGANIZATION_ID'] = previousEnabledOrganizationId;
  }
});

describe('Slack organization capability', () => {
  it('withholds Slack when no organization is configured', () => {
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];

    expect(slackEnabledOrganizationId()).toBeNull();
    expect(slackRolloutConfigured()).toBe(false);
    expect(slackIntegrationEnabledForOrganization('org_noveum')).toBe(false);
  });

  it('withholds Slack when the configured organization is blank', () => {
    process.env['SLACK_ENABLED_ORGANIZATION_ID'] = '   ';

    expect(slackEnabledOrganizationId()).toBeNull();
    expect(slackRolloutConfigured()).toBe(false);
    expect(slackIntegrationEnabledForOrganization('org_noveum')).toBe(false);
  });

  it('enables only the configured organization', () => {
    process.env['SLACK_ENABLED_ORGANIZATION_ID'] = ' org_noveum ';

    expect(slackEnabledOrganizationId()).toBe('org_noveum');
    expect(slackRolloutConfigured()).toBe(true);
    expect(slackIntegrationEnabledForOrganization('org_noveum')).toBe(true);
    expect(slackIntegrationEnabledForOrganization('org_other')).toBe(false);
  });
});
