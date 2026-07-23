import { SQL } from 'bun';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';

const sql = new SQL(connectionString);

await sql`create extension if not exists pg_trgm`;
await sql.close();
