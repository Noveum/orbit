import { ensureLaneDatabase } from '@orbit/db/test-lane';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

const databaseUrl = resolveTestDatabaseUrl('orbit_test_rts');
await ensureLaneDatabase(databaseUrl, 'orbit_test_rts');
process.env['DATABASE_URL'] = databaseUrl;
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://localhost:6380';
process.env['DATABASE_POOL_MAX'] = '2';
