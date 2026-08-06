import { ensureLaneDatabase } from '@orbit/db/test-lane';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

const databaseUrl = resolveTestDatabaseUrl('orbit_test_svc');
await ensureLaneDatabase(databaseUrl, 'orbit_test_svc');
process.env['DATABASE_URL'] = databaseUrl;
process.env['DATABASE_POOL_MAX'] = '2';
