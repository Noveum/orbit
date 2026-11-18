import { spyOn } from 'bun:test';
import type { Database } from '@orbit/db';
import { replacementBarrier } from './github-replacement-fixture.ts';

interface QueryIdentity {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function identity(target: object): QueryIdentity | undefined {
  const toSQL: unknown = Reflect.get(target, 'toSQL', target);
  if (typeof toSQL !== 'function') return undefined;
  const query: unknown = Reflect.apply(toSQL, target, []);
  if (query === null || typeof query !== 'object' || !('sql' in query) || !('params' in query))
    return undefined;
  if (typeof query.sql !== 'string' || !Array.isArray(query.params)) return undefined;
  return { sql: query.sql, params: query.params };
}

function replacementReadContinuation(matches: (query: QueryIdentity) => boolean) {
  const barrier = replacementBarrier();
  let hits = 0;
  function wrap(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    return new Proxy(value, {
      get(target, property) {
        const method: unknown = Reflect.get(target, property, target);
        if (typeof method !== 'function') return method;
        if (property === 'then') {
          return new Proxy(method, {
            apply(original, _receiver, args: unknown[]) {
              const [fulfilled, rejected] = args;
              return Reflect.apply(original, target, [
                async (rows: unknown) => {
                  const query = identity(target);
                  if (hits === 0 && query !== undefined && matches(query)) {
                    hits += 1;
                    await barrier.hold();
                  }
                  return typeof fulfilled === 'function'
                    ? Reflect.apply(fulfilled, undefined, [rows])
                    : rows;
                },
                rejected,
              ]);
            },
          });
        }
        return new Proxy(method, {
          apply(original, _receiver, args: unknown[]) {
            return wrap(Reflect.apply(original, target, args));
          },
        });
      },
    });
  }
  return {
    ...barrier,
    wrap,
    get hits() {
      return hits;
    },
  };
}

export function pauseReplacementRead(
  database: Pick<Database, 'select'>,
  matches: (query: QueryIdentity) => boolean,
) {
  const continuation = replacementReadContinuation(matches);
  const original = database.select;
  const spy = spyOn(database, 'select').mockImplementation(
    new Proxy(original, {
      apply(target, receiver, args: unknown[]) {
        return continuation.wrap(Reflect.apply(target, receiver, args));
      },
    }),
  );
  return {
    arrived: continuation.arrived,
    release: continuation.release,
    get hits() {
      return continuation.hits;
    },
    restore() {
      continuation.release();
      spy.mockRestore();
    },
  };
}

export function pauseReplacementDistinctRead(
  database: Pick<Database, 'selectDistinct'>,
  matches: (query: QueryIdentity) => boolean,
) {
  const continuation = replacementReadContinuation(matches);
  const original = database.selectDistinct;
  const spy = spyOn(database, 'selectDistinct').mockImplementation(
    new Proxy(original, {
      apply(target, receiver, args: unknown[]) {
        return continuation.wrap(Reflect.apply(target, receiver, args));
      },
    }),
  );
  return {
    arrived: continuation.arrived,
    release: continuation.release,
    get hits() {
      return continuation.hits;
    },
    restore() {
      continuation.release();
      spy.mockRestore();
    },
  };
}
