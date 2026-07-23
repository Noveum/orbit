import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

process.env['DATABASE_URL'] = resolveTestDatabaseUrl('orbit_test_core');
process.env['REDIS_URL'] = '';
process.env['DATABASE_POOL_MAX'] = '2';
