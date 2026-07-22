import { defineConfig } from 'drizzle-kit';

const url = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5433/orbit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
