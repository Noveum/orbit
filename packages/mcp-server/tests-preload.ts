import { ensureLaneDatabase } from '@orbit/db/test-lane';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

const databaseUrl = resolveTestDatabaseUrl('orbit_test_mcp');
await ensureLaneDatabase(databaseUrl, 'orbit_test_mcp');
process.env['DATABASE_URL'] = databaseUrl;
process.env['REDIS_URL'] = '';
process.env['DATABASE_POOL_MAX'] = '2';
