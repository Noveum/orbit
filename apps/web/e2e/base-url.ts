import { z } from 'zod';

const baseUrlSchema = z
  .url()
  .transform((value) => {
    const url = new URL(value);
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') url.hostname = 'localhost';
    return url.toString().replace(/\/+$/, '');
  })
  .catch('http://localhost:3000');

export const BASE = baseUrlSchema.parse(
  process.env['ORBIT_E2E_BASE_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'],
);
