import { assertCan, type Principal } from '@orbit/shared/policy';
import { emailConfigured } from '@orbit/shared/utils';

type Environment = Readonly<Record<string, string | undefined>>;

export interface DeploymentCheck {
  readonly id: string;
  readonly title: string;
  readonly status: 'Configured' | 'Needs configuration' | 'Requires verification' | 'Unavailable';
  readonly description: string;
  readonly variables: readonly string[];
}

function configured(environment: Environment, keys: readonly string[]): boolean {
  return keys.every((key) => (environment[key]?.trim().length ?? 0) > 0);
}

function check(
  environment: Environment,
  id: string,
  title: string,
  variables: readonly string[],
  description: string,
): DeploymentCheck {
  return {
    id,
    title,
    variables,
    description,
    status: configured(environment, variables) ? 'Configured' : 'Needs configuration',
  };
}

export function deploymentStatus(
  principal: Principal,
  environment: Environment,
): readonly DeploymentCheck[] {
  assertCan(principal, 'org:manage');
  const password = ['true', '1'].includes(environment['ORBIT_PASSWORD_AUTH'] ?? '');
  const email = emailConfigured(environment);
  const google = configured(environment, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  const github = configured(environment, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']);
  const vercel = environment['VERCEL'] === '1';
  const slackEnabled = environment['SLACK_ENABLED']?.trim().toLowerCase() === 'true';
  const slack = check(
    environment,
    'slack',
    'Slack app',
    ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET'],
    'Enable Slack, configure the app, then connect it from Integrations. Personal DMs also require each member to connect their account.',
  );

  return [
    {
      id: 'authentication',
      title: 'First sign-in',
      status: password || email || google || github ? 'Configured' : 'Needs configuration',
      description:
        'Use password sign-up, Google, GitHub, or an email code to create an account. Passkeys can be registered after sign-in. Creating a workspace makes you its admin; it does not grant server administration.',
      variables: [
        'ORBIT_PASSWORD_AUTH',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GITHUB_CLIENT_ID',
        'GITHUB_CLIENT_SECRET',
      ],
    },
    {
      id: 'email',
      title: 'Email delivery',
      status: email ? 'Configured' : 'Needs configuration',
      description:
        'Resend delivers sign-in codes, invitations, password resets and email notifications. Verify the sender domain in Resend and complete a real delivery test. Configuration alone does not confirm delivery.',
      variables: ['RESEND_API_KEY', 'EMAIL_FROM'],
    },
    {
      id: 'registration',
      title: 'Who can sign up',
      status: 'Requires verification',
      description: configured(environment, ['ALLOWED_EMAIL_DOMAINS'])
        ? 'A server email-domain allowlist restricts registration. Workspace restrictions can narrow it further. An allowlist does not verify ownership of an email address.'
        : 'Registration is open to any email domain. Accounts create their own workspace or join through an invitation. Set an email-domain allowlist before sharing a private deployment.',
      variables: ['ALLOWED_EMAIL_DOMAINS'],
    },
    check(
      environment,
      'urls',
      'Public address',
      ['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL'],
      'Both URLs must match the HTTPS address people use. OAuth callbacks, invitations and password resets depend on them. Rebuild after changing the public URL.',
    ),
    check(
      environment,
      'database',
      'Database',
      ['DATABASE_URL'],
      'Apply and verify migrations before deploying. Confirm that a task remains after reloading. Back up the database together with uploaded files.',
    ),
    check(
      environment,
      'redis',
      'Redis',
      ['REDIS_URL'],
      'Redis supports rate limits and event delivery. Keep it reachable from the application and off the public internet.',
    ),
    check(
      environment,
      'storage',
      'File storage',
      ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
      'The S3 endpoint must be reachable by both the server and browsers. Configure bucket CORS for this app, then test an upload, preview and download.',
    ),
    check(
      environment,
      'github',
      'GitHub app',
      [
        'GITHUB_APP_SLUG',
        'GITHUB_APP_ID',
        'GITHUB_APP_PRIVATE_KEY',
        'GITHUB_APP_CLIENT_ID',
        'GITHUB_APP_CLIENT_SECRET',
        'GITHUB_WEBHOOK_SECRET',
      ],
      'The GitHub integration uses a GitHub App, separate from GitHub sign-in credentials. Configure its callback and webhook URLs, then install it from Integrations.',
    ),
    {
      ...slack,
      status: slackEnabled ? slack.status : 'Unavailable',
      variables: ['SLACK_ENABLED', ...slack.variables],
    },
    {
      id: 'realtime',
      title: 'Live updates',
      status: vercel ? 'Requires verification' : 'Unavailable',
      description: vercel
        ? 'Test changes in two browser windows. Live updates require the Vercel Node WebSocket runtime and Redis.'
        : 'This build requires the Vercel Node WebSocket runtime. Standalone Docker, VPS and Netlify deployments do not provide that bridge. Other clients need a refresh.',
      variables: [],
    },
    {
      id: 'schedules',
      title: 'Scheduled maintenance',
      status: configured(environment, ['CRON_SECRET'])
        ? 'Requires verification'
        : 'Needs configuration',
      description:
        'Schedule authenticated calls for notification retries and sprint rollover every minute, analytics snapshots every six hours, and pruning daily. A configured secret does not prove the scheduler is running. The Docker preview does not schedule these jobs.',
      variables: ['CRON_SECRET'],
    },
  ];
}
