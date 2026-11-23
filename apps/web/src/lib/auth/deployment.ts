import { oAuthProxy } from 'better-auth/plugins';
import { z } from 'zod';

const deploymentSchema = z.object({
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  ORBIT_AUTH_ALLOWED_HOSTS: z.string().default(''),
  OAUTH_PROXY_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
});

const exactHostSchema = z.string().regex(/^[a-zA-Z0-9.-]+(?::\d+)?$/);

const wildcardHostSchema = z
  .string()
  .regex(/^[a-zA-Z0-9-]*\*[a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+){2,}(?::\d+)?$/)
  .refine((host) => !/^\*\.[^.]+\.[^.:]+(?::\d+)?$/.test(host), {
    message: 'A bare wildcard label must sit above at least three fixed labels.',
  });

const hostSchema = z.union([exactHostSchema, wildcardHostSchema]);

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
