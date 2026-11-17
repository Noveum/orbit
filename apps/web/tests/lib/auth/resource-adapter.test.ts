import { describe, expect, test } from 'bun:test';
import { mcp } from '@better-auth/mcp';
import { db, schema } from '@orbit/db';
import { type BetterAuthOptions, betterAuth, type DBAdapter } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { jwt } from 'better-auth/plugins';
import { withOAuthResourceConnectionRetry } from '../../../src/lib/auth/resource-adapter.ts';

const resource = 'https://resource.example.test/mcp';
const resourceModel = 'configuredResource';
const provider = mcp({
  loginPage: '/login',
  consentPage: '/consent',
  resource,
  schema: { oauthResource: { modelName: resourceModel } },
});
const options = { plugins: [provider] } satisfies BetterAuthOptions;
const read = {
  model: resourceModel,
  where: [{ field: 'identifier', value: resource }],
};

function timeout(): Error {
  return Object.assign(new Error('fixture connection failure'), {
    code: 'CONNECT_TIMEOUT',
    errno: 'CONNECT_TIMEOUT',
  });
}

function fixture(failures = 1, disabled = false, configure?: (adapter: DBAdapter) => void) {
  const adapter = memoryAdapter({
    [resourceModel]: [{ id: 'fixture-resource', identifier: resource, disabled }],
  })(options);
  adapter.transaction = (callback) => callback(adapter);
  const originalRead = adapter.findOne;
  let calls = 0;
  const errors: Error[] = [];
  adapter.findOne = async <T>(data: Parameters<DBAdapter['findOne']>[0]): Promise<T | null> => {
    calls += 1;
    if (calls <= failures) {
      const error = timeout();
      errors.push(error);
      throw error;
    }
    return await originalRead<T>(data);
  };
  configure?.(adapter);
  const decorated = withOAuthResourceConnectionRetry(() => adapter, resource)(options);
  return { adapter, decorated, calls: () => calls, errors };
}

describe('OAuth resource connection retry', () => {
  test('preserves the registered adapter object and unwrapped methods', () => {
    const adapter = memoryAdapter({})(options);
    const create = adapter.create;
    const update = adapter.update;
    const findMany = adapter.findMany;
    const configuration = adapter.options;
    const decorated = withOAuthResourceConnectionRetry(() => adapter, resource)(options);
    expect(decorated).toBe(adapter);
    expect(decorated.options).toBe(configuration);
    expect(decorated.create).toBe(create);
    expect(decorated.update).toBe(update);
    expect(decorated.findMany).toBe(findMany);
  });

  test.each([false, true])(
    'recovers the configured resource read without changing disabled=%s',
    async (disabled) => {
      const current = fixture(1, disabled);
      const value = await current.decorated.findOne<{ disabled: boolean }>(read);
      expect(value?.disabled).toBe(disabled);
      expect(current.calls()).toBe(2);
    },
  );

  test('returns a missing resource without another read', async () => {
    const adapter = memoryAdapter({ [resourceModel]: [] })(options);
    const originalRead = adapter.findOne;
    let calls = 0;
    adapter.findOne = async <T>(data: Parameters<DBAdapter['findOne']>[0]): Promise<T | null> => {
      calls += 1;
      return await originalRead<T>(data);
    };
    const decorated = withOAuthResourceConnectionRetry(() => adapter, resource)(options);
    expect(await decorated.findOne(read)).toBeNull();
    expect(calls).toBe(1);
  });

  test('propagates the second timeout without a third read', async () => {
    const current = fixture(2);
    try {
      await current.decorated.findOne(read);
      throw new Error('expected failure');
    } catch (error: unknown) {
      expect(current.errors).toHaveLength(2);
      expect(error).toBe(current.errors[1]);
    }
    expect(current.calls()).toBe(2);
  });

  const excludedReads: Parameters<DBAdapter['findOne']>[0][] = [
    { ...read, model: 'user' },
    { ...read, where: [{ field: 'identifier', value: `${resource}/other` }] },
    { ...read, where: [{ field: 'id', value: resource }] },
    { ...read, where: [{ field: 'identifier', value: resource, operator: 'ne' }] },
    { ...read, where: [{ field: 'identifier', value: resource, mode: 'insensitive' }] },
    { ...read, where: [{ field: 'identifier', value: resource, connector: 'OR' }] },
    { ...read, where: [...read.where, { field: 'disabled', value: false }] },
    { ...read, select: ['identifier'] },
    { ...read, join: {} },
  ];
  test.each(excludedReads)(
    'does not replay a read outside the exact resource lookup',
    async (query) => {
      const current = fixture();
      await expect(current.decorated.findOne(query)).rejects.toBeInstanceOf(Error);
      expect(current.calls()).toBe(1);
    },
  );

  test('does not retry a mutation', async () => {
    const adapter = memoryAdapter({})(options);
    const error = timeout();
    let calls = 0;
    adapter.create = () => {
      calls += 1;
      return Promise.reject(error);
    };
    const decorated = withOAuthResourceConnectionRetry(() => adapter, resource)(options);
    await expect(
      decorated.create({ model: resourceModel, data: { identifier: resource } }),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  test('does not replay the same-adapter transaction callback or its reads', async () => {
    const current = fixture();
    let callbacks = 0;
    await expect(
      current.decorated.transaction(async (transaction) => {
        callbacks += 1;
        expect(transaction).toBe(current.decorated);
        return await transaction.findOne(read);
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(callbacks).toBe(1);
    expect(current.calls()).toBe(1);
  });

  test('does not retry a separately supplied transaction adapter or an outer-adapter read inside it', async () => {
    const transactionAdapter = memoryAdapter({})(options);
    let transactionalCalls = 0;
    transactionAdapter.findOne = () => {
      transactionalCalls += 1;
      return Promise.reject(timeout());
    };
    const current = fixture(1, false, (adapter) => {
      adapter.transaction = (callback) => callback(transactionAdapter);
    });
    const decorated = current.decorated;
    let callbacks = 0;
    await expect(
      decorated.transaction(async (transaction) => {
        callbacks += 1;
        await expect(transaction.findOne(read)).rejects.toBeInstanceOf(Error);
        return decorated.findOne(read);
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(callbacks).toBe(1);
    expect(current.calls()).toBe(1);
    expect(transactionalCalls).toBe(1);
  });

  test('keeps a concurrent nontransactional read eligible', async () => {
    const adapter = memoryAdapter({ [resourceModel]: [{ id: 'resource', identifier: resource }] })(
      options,
    );
    adapter.transaction = (callback) => callback(adapter);
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let outsideCalls = 0;
    const originalRead = adapter.findOne;
    adapter.findOne = async <T>(data: Parameters<DBAdapter['findOne']>[0]): Promise<T | null> => {
      outsideCalls += 1;
      if (outsideCalls === 1) throw timeout();
      return await originalRead<T>(data);
    };
    const decorated = withOAuthResourceConnectionRetry(() => adapter, resource)(options);
    const transaction = decorated.transaction(async () => {
      entered();
      await gate;
    });
    await ready;
    try {
      expect(await decorated.findOne(read)).not.toBeNull();
      expect(outsideCalls).toBe(2);
    } finally {
      release();
      await transaction;
    }
  });

  test('uses the configured logical model in actual provider initialization', async () => {
    const rows = {
      [resourceModel]: [{ id: 'fixture-resource', identifier: resource, disabled: false }],
      user: [],
      account: [],
      session: [],
      verification: [],
      jwks: [],
    };
    const factory = memoryAdapter(rows);
    let resourceCalls = 0;
    const calls: Parameters<DBAdapter['findOne']>[0][] = [];
    const database = withOAuthResourceConnectionRetry((settings) => {
      const adapter = factory(settings);
      const originalRead = adapter.findOne;
      adapter.findOne = async <T>(data: Parameters<DBAdapter['findOne']>[0]): Promise<T | null> => {
        calls.push(data);
        if (data.model === resourceModel && ++resourceCalls === 1) throw timeout();
        return await originalRead<T>(data);
      };
      return adapter;
    }, resource);
    const auth = betterAuth({
      database,
      baseURL: 'https://resource.example.test',
      secret: 'resource-fixture-secret-with-at-least-32-characters',
      logger: { disabled: true },
      plugins: [jwt(), provider],
    });
    await auth.$context;
    expect(resourceCalls).toBe(2);
    expect(calls.filter((query) => query.model === resourceModel)).toEqual([read, read]);
    expect(rows[resourceModel]).toHaveLength(1);
  });
});

test('retains the actual Drizzle schema registration through Better Auth initialization', async () => {
  const settings = {
    baseURL: 'https://resource.example.test',
    secret: 'schema-fixture-secret-with-at-least-32-characters',
    plugins: [{ id: 'oauth-provider', schema: { oauthResource: provider.schema.oauthResource } }],
  } satisfies BetterAuthOptions;
  const adapter = drizzleAdapter(db, { provider: 'pg', schema })(settings);
  const decorated = withOAuthResourceConnectionRetry(() => adapter, resource)(settings);
  const auth = betterAuth({ ...settings, database: () => decorated });
  const context = await auth.$context;
  expect(context.adapter).toBe(adapter);
  expect(context.checkSchema).toBeFunction();
  expect(context.explicitSchemaCheck).toBeFunction();
});

test('does not retry when no OAuth provider is configured', async () => {
  const adapter = memoryAdapter({})({});
  const error = timeout();
  let calls = 0;
  adapter.findOne = () => {
    calls += 1;
    return Promise.reject(error);
  };
  const decorated = withOAuthResourceConnectionRetry(() => adapter, resource)({});
  await expect(decorated.findOne({ ...read, model: 'oauthResource' })).rejects.toBe(error);
  expect(calls).toBe(1);
});
