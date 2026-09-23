import { SLACK_BOT_SCOPES } from '@orbit/shared/constants';
import { assertCan, type Principal } from '@orbit/shared/policy';

type Environment = Readonly<Record<string, string | undefined>>;

export interface SetupValue {
  readonly label: string;
  readonly value: string;
}

export interface DeploymentGuide {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly verification: readonly string[];
  readonly values: readonly SetupValue[];
  readonly links: readonly { readonly label: string; readonly href: string }[];
}

function deploymentOrigin(environment: Environment): string | null {
  try {
    const url = new URL(environment['NEXT_PUBLIC_APP_URL'] ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      url.pathname !== '/' ||
      !url.hostname.includes('.') ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1'
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function slackManifest(origin: string): string {
  return JSON.stringify(
    {
      display_information: { name: 'Orbit', description: 'Task updates and link previews' },
      features: {
        bot_user: { display_name: 'Orbit', always_online: false },
        unfurl_domains: [new URL(origin).hostname],
      },
      oauth_config: {
        redirect_urls: [`${origin}/api/integrations/slack/callback`],
        scopes: { bot: SLACK_BOT_SCOPES },
      },
      settings: {
        event_subscriptions: {
          request_url: `${origin}/api/webhooks/slack`,
          bot_events: ['link_shared'],
        },
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    },
    null,
    2,
  );
}

const integrationDocs = 'https://github.com/Noveum/orbit/blob/main/docs/integrations.md';

export function deploymentGuides(
  principal: Principal,
  environment: Environment,
): readonly DeploymentGuide[] {
  assertCan(principal, 'org:manage');
  const origin = deploymentOrigin(environment);
  const slackValues: SetupValue[] = [];
  const githubValues: SetupValue[] = [];
  const slackLinks = [{ label: 'Slack setup documentation', href: `${integrationDocs}#slack` }];
  if (origin !== null) {
    const manifest = slackManifest(origin);
    slackValues.push(
      { label: 'Slack OAuth redirect URL', value: `${origin}/api/integrations/slack/callback` },
      { label: 'Slack Events API request URL', value: `${origin}/api/webhooks/slack` },
      { label: 'Slack link unfurl domain', value: new URL(origin).hostname },
      { label: 'Slack app manifest', value: manifest },
    );
    slackLinks.unshift({
      label: 'Create Slack app from manifest',
      href: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`,
    });
    githubValues.push(
      { label: 'GitHub callback URL', value: `${origin}/api/integrations/github/callback` },
      { label: 'GitHub webhook URL', value: `${origin}/api/webhooks/github` },
    );
  }
  const addressStep =
    origin === null
      ? [
          'First set NEXT_PUBLIC_APP_URL and BETTER_AUTH_URL to the public HTTPS origin, without a path, query or credentials, then rebuild and redeploy. Provider URLs appear here after that.',
        ]
      : [];
  return [
    {
      id: 'email',
      title: 'Set up email with Resend',
      steps: [
        'In Resend, add your sending domain and publish its DNS records. Wait for the domain to be verified.',
        'Create a Resend API key with permission to send from that domain. Set RESEND_API_KEY in the hosting environment. Set EMAIL_FROM to a sender on the verified domain, such as Orbit <notifications@your-domain.com>.',
        'Rebuild and redeploy using the hosting instructions above. Email codes, invitations, password resets and notification emails share this sender across all workspaces.',
      ],
      verification: [
        'Request an email sign-in code for your own address and use it to sign in. Confirm the message appears in Resend delivery logs and arrives in your mailbox.',
        'Invite a consenting teammate from Members and verify that the invitation opens this deployment. Test a password reset if password sign-in is enabled.',
        'Enable your email notification preferences, then have a teammate assign you a test task. Check your inbox and the Resend delivery log.',
        'If notification delivery is paused with NOTIFICATION_PROVIDERS_PAUSED=true, ask the operator whether it is safe to resume. Confirm the notification scheduler is running. This pause does not disable sign-in or invitation emails.',
      ],
      values: [
        {
          label: 'Email environment template',
          value:
            'RESEND_API_KEY=<your-resend-api-key>\nEMAIL_FROM="Orbit <notifications@your-domain.com>"',
        },
      ],
      links: [
        { label: 'Open Resend domains', href: 'https://resend.com/domains' },
        { label: 'Open Resend API keys', href: 'https://resend.com/api-keys' },
        { label: 'Manage members', href: '/settings/members' },
        { label: 'Email notification preferences', href: '/settings/notifications' },
      ],
    },
    {
      id: 'slack',
      title: 'Set up the Slack app',
      steps: [
        ...addressStep,
        'Create a Slack app using the generated manifest. It includes the eight required bot scopes, OAuth redirect, HTTP Events API URL, link_shared event and your Orbit unfurl domain. Socket Mode, slash commands and app-level tokens are not needed.',
        'Open Basic Information > App Credentials in Slack. Copy the Client ID, Client Secret and Signing Secret into SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET in the hosting environment. Keep SLACK_ENABLED=false while preparing the deployment.',
        'If people will connect other Slack workspaces, activate public distribution in Slack. A private app can only be installed in its development workspace.',
        'After applying migrations and configuring the app, set SLACK_ENABLED=true and redeploy. This makes Slack available to every Orbit workspace. Return to Slack to verify the Events API URL; retry verification after enabling if Slack could not reach it during app creation.',
        'Open Slack in Integrations and choose Add to Slack. Approve access as a workspace admin, invite the bot to a channel, then map that channel to an Orbit team or explicitly to the whole workspace. Reinstall if scopes or the unfurl domain change.',
      ],
      verification: [
        'Confirm Slack reports the Events API request URL as verified and Orbit shows the workspace as connected.',
        'In a controlled mapped channel, verify a test task update arrives and an Orbit issue link produces a preview. An unmapped channel should not receive a preview.',
        'Sync Slack members, connect your personal Slack account if needed, and enable Slack DM preferences. Have a teammate assign you a test task. Review delivery diagnostics in Integrations for failures.',
        'Confirm scheduled notifications are running. NOTIFICATION_PROVIDERS_PAUSED=true pauses outbound notification delivery; the operator should only resume it after any maintenance or incident is resolved.',
      ],
      values: [
        {
          label: 'Slack environment template',
          value:
            'SLACK_ENABLED=false\nSLACK_CLIENT_ID=<slack-client-id>\nSLACK_CLIENT_SECRET=<slack-client-secret>\nSLACK_SIGNING_SECRET=<slack-signing-secret>',
        },
        ...slackValues,
      ],
      links: [
        ...slackLinks,
        { label: 'Open Slack integration', href: '/settings/integrations?provider=slack' },
      ],
    },
    {
      id: 'github',
      title: 'Set up the GitHub App',
      steps: [
        ...addressStep,
        'Create a GitHub App, separate from the GitHub OAuth app used for sign-in. Set its callback and webhook URLs to the values below. Enable Request user authorization (OAuth) during installation. Leave Setup URL empty or use the callback URL.',
        'Use the read-only repository permissions and event subscriptions in the GitHub App permissions guide. Generate a private key, a client secret and a webhook secret. Record the app ID, slug and client ID.',
        'Set all six GitHub App environment variables below. Preserve the PEM private key, using actual newlines or escaped \\n sequences. Rebuild and redeploy, then connect GitHub from Integrations and select repositories.',
      ],
      verification: [
        'Confirm the connected installation lists the expected repositories, then associate a repository with an Orbit project or workspace.',
        'Open a test pull request referencing an Orbit issue. Confirm it appears in Pull requests and inspect webhook delivery results in Integrations and GitHub.',
      ],
      values: [
        {
          label: 'GitHub environment template',
          value:
            'GITHUB_APP_ID=<app-id>\nGITHUB_APP_SLUG=<app-slug>\nGITHUB_APP_PRIVATE_KEY=<private-key-pem>\nGITHUB_APP_CLIENT_ID=<client-id>\nGITHUB_APP_CLIENT_SECRET=<client-secret>\nGITHUB_WEBHOOK_SECRET=<webhook-secret>',
        },
        ...githubValues,
      ],
      links: [
        { label: 'Create GitHub App', href: 'https://github.com/settings/apps/new' },
        {
          label: 'GitHub App permissions guide',
          href: 'https://github.com/Noveum/orbit/blob/main/docs/github-app.md',
        },
        { label: 'Open GitHub integration', href: '/settings/integrations?provider=github' },
      ],
    },
  ];
}
