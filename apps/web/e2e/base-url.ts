import { z } from 'zod';

const baseUrlSchema = z
  .url()
  .transform((value) => value.replace(/\/+$/, ''))
  .catch('http://localhost:3000');

export const BASE = baseUrlSchema.parse(
  process.env['ORBIT_E2E_BASE_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'],
);
