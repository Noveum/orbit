import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

assert.equal(process.versions.node.split('.')[0], '24');
assert.equal(process.versions.bun, undefined);
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      ['next/headers', 'next/navigation'].includes(specifier) ? `${specifier}.js` : specifier,
      context,
    );
  },
});
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '1');
assert.equal(database.pathname, '/orbit_test_cold_import');
for (const key of Object.keys(process.env))
  assert(!/GITHUB|GOOGLE|RESEND|SLACK|REDIS|S3|PRODUCTION_DATABASE/.test(key));
let connectionAttempts = 0;
let fetchAttempts = 0;
let startupSeedErrors = 0;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function () {
  connectionAttempts += 1;
  queueMicrotask(() =>
    this.destroy(
      Object.assign(new Error('Blocked cold import database fixture'), { code: 'ECONNREFUSED' }),
    ),
  );
  return this;
};
const secureConnect = tls.connect;
tls.connect = () => {
  connectionAttempts += 1;
  throw new Error('Blocked cold import TLS fixture');
};
globalThis.fetch = () => {
  fetchAttempts += 1;
  return Promise.reject(new Error('Blocked cold import fetch fixture'));
};
for (const name of ['log', 'info', 'warn', 'error', 'debug'])
  console[name] = (...values) => {
    if (
      values.some(
        (value) =>
          typeof value === 'string' && value.includes('could not seed `resources` at startup'),
      )
    )
      startupSeedErrors += 1;
  };
try {
  assert.equal(typeof process.argv[2], 'string');
  const loaded = await import(pathToFileURL(process.argv[2]).href);
  const context = Reflect.get(globalThis, 'orbitColdAuthContext');
  if (context !== undefined) await context;
  const pool = Reflect.get(globalThis, 'orbitPool');
  if (pool !== undefined) await pool.sql.end({ timeout: 1 });
  process.stdout.write(
    `${JSON.stringify({ runtime: process.version, handlerExported: typeof loaded.POST === 'function' || typeof loaded.GET === 'function', authInitializations: Reflect.get(globalThis, 'orbitColdAuthInitializations') ?? 0, connectionAttempts, fetchAttempts, startupSeedErrors })}\n`,
  );
} finally {
  net.Socket.prototype.connect = connect;
  tls.connect = secureConnect;
}
