import { z } from 'zod';

const envSchema = z.object({
  MCP_PORT: z.coerce.number().int().min(0).max(65535).default(3200),
});

export const env = envSchema.parse(process.env);
