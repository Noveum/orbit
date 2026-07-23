import { z } from 'zod';

const serverEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  EMAIL_FROM: z.string().min(1).default('Orbit <auth@orbit.local>'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached === null) cached = serverEnvSchema.parse(process.env);
  return cached;
}

const publicAppUrlSchema = z.url().default('http://localhost:3000');

export function publicAppUrl(): string {
  return publicAppUrlSchema.parse(process.env['NEXT_PUBLIC_APP_URL']).replace(/\/+$/, '');
}

export function absoluteUrl(path: string): string {
  return new URL(path, `${publicAppUrl()}/`).toString();
}
