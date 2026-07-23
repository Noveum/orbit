import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

process.env['DATABASE_URL'] = resolveTestDatabaseUrl('orbit_test_svc');
process.env['DATABASE_POOL_MAX'] = '2';
