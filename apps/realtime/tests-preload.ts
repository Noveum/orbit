import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

process.env['DATABASE_URL'] = resolveTestDatabaseUrl('orbit_test_rt');
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://localhost:6380';
process.env['DATABASE_POOL_MAX'] = '2';
