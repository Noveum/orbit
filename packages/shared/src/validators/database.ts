import { z } from 'zod';

export const databaseTlsEnvironmentSchema = z
  .object({
    DATABASE_REQUIRE_TLS: z.enum(['true', 'false']).default('false'),
    DATABASE_TLS_CA_PEM: z.string().trim().min(1).optional(),
  })
  .refine(
    (value) => value.DATABASE_TLS_CA_PEM === undefined || value.DATABASE_REQUIRE_TLS === 'true',
  );
