import postgres from 'postgres';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';

const sql = postgres(connectionString);

await sql`create extension if not exists pg_trgm`;
await sql.end();
