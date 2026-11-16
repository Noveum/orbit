import { mock } from 'bun:test';

let options: unknown;
const stop = (): never => {
  throw new Error('Stopped before any database query.');
};
mock.module('postgres', () => ({
  default: (_url: string, configured: unknown) => {
    options = configured;
    return Object.assign(stop, { unsafe: stop, end: () => Promise.resolve() });
  },
}));

const url = 'postgres://fixture:fixture@127.0.0.1:9/orbit_test_tls?sslmode=disable';
const mode = process.argv[2];
try {
  if (mode === 'catalog') {
    const { liveCatalog } = await import('../../src/check-drift.ts');
    await liveCatalog(url);
  } else if (mode === 'release') {
    const { releaseDatabase } = await import('../../src/migration-release.ts');
    await releaseDatabase(url, new URL('../../drizzle', import.meta.url).pathname);
  } else if (mode === 'readiness') {
    const { getRecoveryState } = await import('../../../services/src/backup/readiness.ts');
    await getRecoveryState(url);
  } else if (mode === 'preflight') {
    const { verifyPreflight } = await import('../../../services/src/backup/preflight.ts');
    await verifyPreflight(url);
  } else {
    throw new Error('Unknown local fixture.');
  }
} catch {
  if (typeof options !== 'object' || options === null) throw new Error('No constructor captured.');
  const ssl: unknown = Reflect.get(options, 'ssl');
  if (typeof ssl !== 'object' || ssl === null || Reflect.get(ssl, 'rejectUnauthorized') !== true) {
    throw new Error('Maintenance connection did not enforce verified TLS.');
  }
  if (Reflect.get(options, 'max') !== 1 || Reflect.get(options, 'prepare') !== false) {
    throw new Error('Maintenance pool limits changed.');
  }
  process.stdout.write(JSON.stringify({ verifiedTls: true, noDatabaseQuery: true }));
}
