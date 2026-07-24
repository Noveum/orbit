import { z } from 'zod';

const envSchema = z.object({
  REALTIME_PORT: z.coerce.number().int().min(0).max(65535).default(3100),
  REDIS_URL: z.string().min(1).default('redis://localhost:6380'),
  BETTER_AUTH_SECRET: z.string().min(16),
});

export const env = envSchema.parse(process.env);
