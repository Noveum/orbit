import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';
import { ensureLaneDatabase } from '../db/src/test-lane.ts';

const databaseUrl = resolveTestDatabaseUrl('orbit_test_mcp');
await ensureLaneDatabase(databaseUrl, 'orbit_test_mcp');
process.env['DATABASE_URL'] = databaseUrl;
process.env['REDIS_URL'] = '';
process.env['DATABASE_POOL_MAX'] = '2';
