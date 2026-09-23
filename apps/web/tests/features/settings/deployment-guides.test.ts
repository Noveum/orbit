import { describe, expect, it } from 'bun:test';
import { SLACK_BOT_SCOPES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { deploymentGuides } from '@/features/settings/deployment-guides.ts';

const admin: Principal = { userId: 'user', organizationId: 'org', role: 'admin', teamIds: [] };

describe('deployment setup guides', () => {
  it.each(['member', 'contributor', 'guest'] as const)(
    'denies configuration guides to %s',
    (role) => {
      expect(() => deploymentGuides({ ...admin, role }, {})).toThrow(
        'Your role cannot org manage.',
      );
    },
  );

  it('generates an installable manifest for the configured public origin', () => {
    const guides = deploymentGuides(admin, { NEXT_PUBLIC_APP_URL: 'https://orbit.example.com/' });
    const slack = guides.find((guide) => guide.id === 'slack');
    const link = slack?.links.find((entry) => entry.label === 'Create Slack app from manifest');
    expect(link).toBeDefined();
    const url = new URL(link?.href ?? '');
    expect(url.origin).toBe('https://api.slack.com');
    const manifest = JSON.parse(url.searchParams.get('manifest_json') ?? '{}');
    expect(manifest.oauth_config.redirect_urls).toEqual([
      'https://orbit.example.com/api/integrations/slack/callback',
    ]);
    expect(manifest.oauth_config.scopes.bot).toEqual([...SLACK_BOT_SCOPES]);
    expect(manifest.oauth_config.scopes.bot).toHaveLength(8);
    expect(manifest.features.unfurl_domains).toEqual(['orbit.example.com']);
    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: 'https://orbit.example.com/api/webhooks/slack',
      bot_events: ['link_shared'],
    });
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.settings.token_rotation_enabled).toBe(false);
    expect(slack?.values.find((value) => value.label === 'Slack app manifest')?.value).toBe(
      url.searchParams.get('manifest_json') ?? undefined,
    );
    expect(guides.find((guide) => guide.id === 'github')?.values).toContainEqual({
      label: 'GitHub callback URL',
      value: 'https://orbit.example.com/api/integrations/github/callback',
    });
  });

  it.each([
    '',
    'invalid',
    'javascript:alert(1)',
    'http://orbit.example.com',
    'http://localhost:3000',
    'https://localhost',
    'https://127.0.0.1',
    'https://app.localhost',
    'https://secret:password@orbit.example.com',
    'https://orbit.example.com/path',
    'https://orbit.example.com?secret=private',
    'https://orbit.example.com#private',
  ])('withholds generated provider URLs for invalid public address %s', (origin) => {
    const guides = deploymentGuides(admin, { NEXT_PUBLIC_APP_URL: origin });
    for (const id of ['slack', 'github']) {
      const guide = guides.find((entry) => entry.id === id);
      expect(guide?.steps[0]).toContain('First set NEXT_PUBLIC_APP_URL');
      expect(guide?.values.some((value) => value.label.includes('URL'))).toBe(false);
    }
    expect(
      guides.flatMap((guide) => guide.links).some((link) => link.href.includes('manifest_json')),
    ).toBe(false);
    expect(JSON.stringify(guides)).not.toContain('secret:password');
    expect(JSON.stringify(guides)).not.toContain('secret=private');
  });

  it('never includes existing server credentials or tenant values in templates or links', () => {
    const serialized = JSON.stringify(
      deploymentGuides(admin, {
        NEXT_PUBLIC_APP_URL: 'https://orbit.example.com',
        RESEND_API_KEY: 'sensitive-resend-value',
        EMAIL_FROM: 'private-sender@private.example',
        SLACK_CLIENT_ID: 'sensitive-client-id',
        SLACK_CLIENT_SECRET: 'sensitive-client-secret',
        SLACK_SIGNING_SECRET: 'sensitive-signing-value',
        GITHUB_APP_PRIVATE_KEY: 'sensitive-pem-value',
        BETTER_AUTH_SECRET: 'sensitive-auth-value',
        DATABASE_URL: 'sensitive-database-value',
      }),
    );
    expect(serialized).not.toContain('sensitive-');
    expect(serialized).not.toContain('private-sender');
    expect(serialized).toContain('RESEND_API_KEY');
    expect(serialized).toContain('SLACK_SIGNING_SECRET');
    expect(serialized).toContain('GITHUB_WEBHOOK_SECRET');
  });
});
