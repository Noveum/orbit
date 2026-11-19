import { afterAll, describe, expect, it } from 'bun:test';
import { eq, sql, TransactionRollbackError } from 'drizzle-orm';
import { z } from 'zod';
import {
  createDatabaseScope,
  db,
  pool,
  registerPrivateDatabaseProxy,
  withRequestScopedDatabase,
} from '../src/client.ts';
import * as schema from '../src/schema/index.ts';

const sessionSchema = z.array(z.object({ pid: z.number(), application: z.string() })).length(1);

async function session(): Promise<{ pid: number; application: string }> {
  const rows = await db.execute(
    sql`select pg_backend_pid() as pid, current_setting('application_name') as application`,
  );
  const [row] = sessionSchema.parse([...rows]);
  if (row === undefined) throw new Error('The session query returned no row.');
  return row;
}

afterAll(() => {
  registerPrivateDatabaseProxy(undefined);
});

describe('a request scoped database', () => {
  it('exposes the callable Postgres.js client and uses prepared queries through Hyperdrive', () => {
    expect(db.$client).toBe(pool);
    registerPrivateDatabaseProxy(() => 'postgres://orbit:orbit@localhost:5432/orbit');
    try {
      withRequestScopedDatabase(() => {
        expect(db.$client).not.toBe(pool);
        expect(typeof db.$client.unsafe).toBe('function');
        expect(db.$client.options.prepare).toBe(true);
        expect(db.$client.options.fetch_types).toBe(false);
      });
    } finally {
      registerPrivateDatabaseProxy(undefined);
    }
  });

  it('opens its own connection instead of borrowing the process pool', async () => {
    const outside = await session();
    const inside = await withRequestScopedDatabase(session);
    expect(inside.pid).not.toBe(outside.pid);
    expect((await session()).pid).toBe(outside.pid);
  });

  it('keeps one connection for the whole asynchronous request', async () => {
    const pids = await withRequestScopedDatabase(async () => {
      const first = await session();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await Promise.resolve().then(session);
      return [first.pid, second.pid];
    });
    expect(pids[0]).toBe(pids[1]);
  });

  it('gives two requests two connections', async () => {
    const [left, right] = await Promise.all([
      withRequestScopedDatabase(session),
      withRequestScopedDatabase(session),
    ]);
    expect(left.pid).not.toBe(right.pid);
  });

  it('shares one connection across every run of a long lived scope', async () => {
    const scope = createDatabaseScope();
    const first = await scope(session);
    const second = await scope(session);
    expect(second.pid).toBe(first.pid);
  });

  it('runs transactions on the scoped connection', async () => {
    const result = await withRequestScopedDatabase(async () => {
      const own = await session();
      const within = await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`select pg_backend_pid() as pid`);
        return z.array(z.object({ pid: z.number() })).parse([...rows])[0]?.pid;
      });
      return { own: own.pid, within };
    });
    expect(result.within).toBe(result.own);
  });

  it('round trips array, json and timestamp columns on a scoped connection, which looks up no types', async () => {
    const id = `scoped-array-${crypto.randomUUID()}`;
    const createdAt = new Date('2026-11-18T12:00:00.000Z');
    await withRequestScopedDatabase(async () => {
      expect(db.$client.options.fetch_types).toBe(false);
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(schema.oauthProviderClient).values({
            id,
            clientId: id,
            redirectUris: ['https://one.example/callback', 'https://two.example/a,b "quoted"'],
            scopes: [],
            metadata: { nested: { values: [1, 'two'] } },
            createdAt,
          });
          const [row] = await tx
            .select({
              redirectUris: schema.oauthProviderClient.redirectUris,
              scopes: schema.oauthProviderClient.scopes,
              clientCredentialsScopes: schema.oauthProviderClient.clientCredentialsScopes,
              metadata: schema.oauthProviderClient.metadata,
              createdAt: schema.oauthProviderClient.createdAt,
              disabled: schema.oauthProviderClient.disabled,
            })
            .from(schema.oauthProviderClient)
            .where(eq(schema.oauthProviderClient.id, id));
          expect(row).toEqual({
            redirectUris: ['https://one.example/callback', 'https://two.example/a,b "quoted"'],
            scopes: [],
            clientCredentialsScopes: [],
            metadata: { nested: { values: [1, 'two'] } },
            createdAt,
            disabled: false,
          });
          tx.rollback();
        }),
      ).rejects.toBeInstanceOf(TransactionRollbackError);
    });
  });

  it('asks for the private proxy when a scoped request connects, never before', async () => {
    const proxied = new URL(process.env['DATABASE_URL'] ?? '');
    proxied.searchParams.set('application_name', 'orbit-private-proxy');
    let resolved = 0;
    registerPrivateDatabaseProxy(() => {
      resolved += 1;
      return proxied.toString();
    });
    expect(resolved).toBe(0);
    expect((await withRequestScopedDatabase(session)).application).toBe('orbit-private-proxy');
    expect(resolved).toBe(1);
    expect((await session()).application).not.toBe('orbit-private-proxy');
    registerPrivateDatabaseProxy(() => undefined);
    expect((await withRequestScopedDatabase(session)).application).not.toBe('orbit-private-proxy');
    registerPrivateDatabaseProxy(undefined);
    expect((await withRequestScopedDatabase(session)).application).not.toBe('orbit-private-proxy');
  });
});
