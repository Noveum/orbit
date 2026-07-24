import { z } from 'zod';

const envSchema = z.object({
  MCP_PORT: z.coerce.number().int().min(0).max(65535).default(3200),
  ORBIT_PUBLIC_URL: z.url().default('http://localhost:3000'),
});

const parsed = envSchema.parse(process.env);

export const env = {
  MCP_PORT: parsed.MCP_PORT,
  ORBIT_PUBLIC_URL: parsed.ORBIT_PUBLIC_URL.replace(/\/+$/, ''),
};
