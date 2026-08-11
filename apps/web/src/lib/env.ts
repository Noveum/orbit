import { z } from 'zod';

type Environment = Readonly<Record<string, string | undefined>>;

const configured = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

const configuredPair = (environment: Environment, first: string, second: string): boolean =>
  configured(environment[first]) && configured(environment[second]);

function senderDomainOf(value: string): string | null {
  const angleAddress = /<([^<>]+)>$/.exec(value)?.[1];
  const address = (angleAddress ?? value).trim();
  const parsed = z.email().safeParse(address);
  if (!parsed.success) return null;
  return parsed.data.slice(parsed.data.lastIndexOf('@') + 1).toLowerCase();
}

export function assertProductionAuthenticationConfigured(
  environment: Environment = process.env,
): void {
  if (environment['NODE_ENV'] !== 'production') return;

  const passwordAuthentication =
    environment['ORBIT_PASSWORD_AUTH'] === 'true' || environment['ORBIT_PASSWORD_AUTH'] === '1';
  const googleAuthentication = configuredPair(
    environment,
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  );
  const githubAuthentication = configuredPair(
    environment,
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
  );
  const emailFrom = environment['EMAIL_FROM']?.trim() ?? '';
  const senderDomain = senderDomainOf(emailFrom);
  const magicLinkAuthentication =
    configured(environment['RESEND_API_KEY']) &&
    senderDomain !== null &&
    senderDomain !== 'localhost' &&
    !senderDomain.endsWith('.local');

  if (
    passwordAuthentication ||
    googleAuthentication ||
    githubAuthentication ||
    magicLinkAuthentication
  ) {
    return;
  }

  throw new Error(
    'Production requires a usable first-login method. Set ORBIT_PASSWORD_AUTH=true, both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or both RESEND_API_KEY and a non-local EMAIL_FROM.',
  );
}

export function assertProductionStartupAuthenticationConfigured(
  environment: Environment = process.env,
): void {
  assertProductionAuthenticationConfigured({ ...environment, NODE_ENV: 'production' });
}

const serverEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  EMAIL_FROM: z.string().min(1).default('Orbit <auth@orbit.local>'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  ORBIT_PASSWORD_AUTH: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached === null) cached = serverEnvSchema.parse(process.env);
  return cached;
}

export interface GithubAppConfig {
  readonly slug: string;
  readonly appId: string;
  readonly privateKey: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const githubAppEnvSchema = z.object({
  GITHUB_APP_SLUG: z.string().default(''),
  GITHUB_APP_ID: z.string().default(''),
  GITHUB_APP_PRIVATE_KEY: z.string().default(''),
  GITHUB_APP_CLIENT_ID: z.string().default(''),
  GITHUB_APP_CLIENT_SECRET: z.string().default(''),
});

export function githubAppConfig(): GithubAppConfig {
  const env = githubAppEnvSchema.parse(process.env);
  const rawKey = env.GITHUB_APP_PRIVATE_KEY;
  return {
    slug: env.GITHUB_APP_SLUG,
    appId: env.GITHUB_APP_ID,
    privateKey: rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey,
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  };
}

export function githubUserVerificationReady(): boolean {
  const config = githubAppConfig();
  return config.clientId.length > 0 && config.clientSecret.length > 0;
}

export function githubConnectReady(): boolean {
  return githubAppConfig().slug.length > 0;
}

export function githubDiscoveryReady(): boolean {
  const config = githubAppConfig();
  return config.appId.length > 0 && config.privateKey.length > 0;
}

export interface SlackAppConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export function slackAppConfig(): SlackAppConfig {
  const env = serverEnv();
  return { clientId: env.SLACK_CLIENT_ID ?? '', clientSecret: env.SLACK_CLIENT_SECRET ?? '' };
}

export function slackConnectReady(): boolean {
  const config = slackAppConfig();
  return config.clientId.length > 0 && config.clientSecret.length > 0;
}

const publicAppUrlSchema = z.url().default('http://localhost:3000');

export function publicAppUrl(): string {
  return publicAppUrlSchema.parse(process.env['NEXT_PUBLIC_APP_URL']).replace(/\/+$/, '');
}

export function absoluteUrl(path: string): string {
  return new URL(path, `${publicAppUrl()}/`).toString();
}

const mcpUrlSchema = z.url();

export function mcpServerUrl(): string {
  const explicit = process.env['NEXT_PUBLIC_MCP_URL'];
  if (explicit !== undefined && explicit.trim().length > 0) {
    return mcpUrlSchema.parse(explicit).replace(/\/+$/, '');
  }
  return absoluteUrl('/mcp').replace(/\/+$/, '');
}
