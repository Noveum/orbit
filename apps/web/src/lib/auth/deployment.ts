import { oAuthProxy } from 'better-auth/plugins';
import { z } from 'zod';

const deploymentSchema = z.object({
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  ORBIT_AUTH_ALLOWED_HOSTS: z.string().default(''),
  OAUTH_PROXY_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
});

const hostSchema = z.string().regex(/^[a-zA-Z0-9*.-]+(?::\d+)?$/);

export function deploymentAuthOptions(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const env = deploymentSchema.parse(environment);
  const canonical = new URL(env.BETTER_AUTH_URL);
  const allowedHosts = [
    canonical.host,
    ...env.ORBIT_AUTH_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL]
      .map((host) => host?.trim())
      .filter((host) => host !== undefined && host.length > 0),
  ].map((host) => hostSchema.parse(host));
  const plugins: [] | [ReturnType<typeof oAuthProxy>] = env.OAUTH_PROXY_SECRET
    ? [oAuthProxy({ productionURL: canonical.origin, secret: env.OAUTH_PROXY_SECRET })]
    : [];

  return {
    baseURL:
      allowedHosts.length === 1
        ? canonical.origin
        : {
            allowedHosts: [...new Set(allowedHosts)],
            fallback: canonical.origin,
          },
    plugins,
  };
}
