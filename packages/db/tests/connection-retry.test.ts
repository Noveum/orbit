import { describe, expect, test } from 'bun:test';
import { retryInitialDatabaseConnection } from '../src/connection-retry.ts';

function timeout(): Error {
  return Object.assign(new Error('fixture connection did not become ready'), {
    code: 'CONNECT_TIMEOUT',
    errno: 'CONNECT_TIMEOUT',
  });
}

describe('retryInitialDatabaseConnection', () => {
  test('recovers a read that first fails before the connection becomes ready', async () => {
    let attempts = 0;
    const value = { disabled: false };
    const result = await retryInitialDatabaseConnection(
      () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(timeout()) : Promise.resolve(value);
      },
      () => true,
    );
    expect(result).toBe(value);
    expect(attempts).toBe(2);
  });

  test('recognizes the driver cause inside a query error', async () => {
    let attempts = 0;
    const wrapped = new Error('query failed', { cause: timeout() });
    const result = await retryInitialDatabaseConnection(
      () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(wrapped) : Promise.resolve(null);
      },
      () => true,
    );
    expect(result).toBeNull();
    expect(attempts).toBe(2);
  });

  test('stops after the second failure and preserves its identity', async () => {
    const second = timeout();
    let attempts = 0;
    await expect(
      retryInitialDatabaseConnection(
        () => {
          attempts += 1;
          return Promise.reject(attempts === 1 ? timeout() : second);
        },
        () => true,
      ),
    ).rejects.toBe(second);
    expect(attempts).toBe(2);
  });

  test('does not retry outside the initial read phase', async () => {
    const error = timeout();
    let attempts = 0;
    await expect(
      retryInitialDatabaseConnection(
        () => {
          attempts += 1;
          return Promise.reject(error);
        },
        () => false,
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  test('rechecks the phase after failure before starting another attempt', async () => {
    const error = timeout();
    let phase = true;
    let attempts = 0;
    await expect(
      retryInitialDatabaseConnection(
        () => {
          attempts += 1;
          phase = false;
          return Promise.reject(error);
        },
        () => phase,
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  test.each(['28P01', '42P01', '25P02', '57014', 'ECONNRESET', 'CERT_HAS_EXPIRED'])(
    'does not retry %s',
    async (code) => {
      const error = Object.assign(new Error('fixture failure'), { code, errno: code });
      let attempts = 0;
      await expect(
        retryInitialDatabaseConnection(
          () => {
            attempts += 1;
            return Promise.reject(error);
          },
          () => true,
        ),
      ).rejects.toBe(error);
      expect(attempts).toBe(1);
    },
  );

  test.each([
    Object.assign(new Error('CONNECT_TIMEOUT'), { code: 'CONNECT_TIMEOUT' }),
    Object.assign(new Error('CONNECT_TIMEOUT'), { errno: 'CONNECT_TIMEOUT' }),
    { code: 'CONNECT_TIMEOUT', errno: 'CONNECT_TIMEOUT' },
    new Error('CONNECT_TIMEOUT'),
    Object.assign(new Error('aborted', { cause: timeout() }), { name: 'AbortError' }),
    Object.assign(new Error('statement aborted', { cause: timeout() }), { code: '25P02' }),
  ])('rejects incomplete or non-driver timeout shapes', async (error) => {
    let attempts = 0;
    await expect(
      retryInitialDatabaseConnection(
        () => {
          attempts += 1;
          return Promise.reject(error);
        },
        () => true,
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  test('does not invoke getters while inspecting the cause chain', async () => {
    let getterCalls = 0;
    const error = new Error('fixture wrapper');
    Object.defineProperty(error, 'cause', {
      get: () => {
        getterCalls += 1;
        return timeout();
      },
    });
    await expect(
      retryInitialDatabaseConnection(
        () => Promise.reject(error),
        () => true,
      ),
    ).rejects.toBe(error);
    expect(getterCalls).toBe(0);
  });

  test('does not invoke code or errno accessors', async () => {
    let getterCalls = 0;
    const error = new Error('fixture');
    for (const key of ['code', 'errno'])
      Object.defineProperty(error, key, {
        get: () => {
          getterCalls += 1;
          return 'CONNECT_TIMEOUT';
        },
      });
    await expect(
      retryInitialDatabaseConnection(
        () => Promise.reject(error),
        () => true,
      ),
    ).rejects.toBe(error);
    expect(getterCalls).toBe(0);
  });

  test('rejects a cyclic error chain without looping', async () => {
    const error = new Error('fixture');
    Object.defineProperty(error, 'cause', { value: error });
    let attempts = 0;
    await expect(
      retryInitialDatabaseConnection(
        () => {
          attempts += 1;
          return Promise.reject(error);
        },
        () => true,
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  test('keeps concurrent recovery budgets independent', async () => {
    const attempts: [number, number] = [0, 0];
    const run = (index: 0 | 1) =>
      retryInitialDatabaseConnection(
        () => {
          attempts[index] += 1;
          return attempts[index] === 1 ? Promise.reject(timeout()) : Promise.resolve(index);
        },
        () => true,
      );
    expect(await Promise.all([run(0), run(1)])).toEqual([0, 1]);
    expect(attempts).toEqual([2, 2]);
  });
});

test('does not traverse an unbounded cause chain', async () => {
  let error = timeout();
  for (let depth = 0; depth < 32; depth += 1) error = new Error('wrapper', { cause: error });
  let attempts = 0;
  await expect(
    retryInitialDatabaseConnection(
      () => {
        attempts += 1;
        return Promise.reject(error);
      },
      () => true,
    ),
  ).rejects.toBe(error);
  expect(attempts).toBe(1);
});

test('preserves errors whose inspection throws', async () => {
  const error = new Proxy(timeout(), {
    getOwnPropertyDescriptor() {
      throw new Error('inspection forbidden');
    },
  });
  let attempts = 0;
  await expect(
    retryInitialDatabaseConnection(
      () => {
        attempts += 1;
        return Promise.reject(error);
      },
      () => true,
    ),
  ).rejects.toBe(error);
  expect(attempts).toBe(1);
});

test('does not invoke an inherited name accessor', async () => {
  let calls = 0;
  const prototype = Object.create(Error.prototype);
  Object.defineProperty(prototype, 'name', {
    get() {
      calls += 1;
      return 'Error';
    },
  });
  const error = timeout();
  Object.setPrototypeOf(error, prototype);
  let attempts = 0;
  await expect(
    retryInitialDatabaseConnection(
      () => {
        attempts += 1;
        return Promise.reject(error);
      },
      () => true,
    ),
  ).rejects.toBe(error);
  expect(attempts).toBe(1);
  expect(calls).toBe(0);
});

test('does not gain retry permission after starting outside the phase', async () => {
  let phase = false;
  let attempts = 0;
  const error = timeout();
  await expect(
    retryInitialDatabaseConnection(
      () => {
        attempts += 1;
        phase = true;
        return Promise.reject(error);
      },
      () => phase,
    ),
  ).rejects.toBe(error);
  expect(attempts).toBe(1);
});

test('returns successful values unchanged outside the retry phase', async () => {
  const value = { disabled: true };
  expect(
    await retryInitialDatabaseConnection(
      () => Promise.resolve(value),
      () => false,
    ),
  ).toBe(value);
});
