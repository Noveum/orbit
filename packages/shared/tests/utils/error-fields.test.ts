import { describe, expect, it } from 'bun:test';
import { safeErrorFields, withDatabaseLogBoundary } from '../../src/utils/error-fields.ts';

describe('safeErrorFields', () => {
  it('keeps a useful database cause without logging SQL or parameters', () => {
    const cause = Object.assign(new Error('Connection terminated unexpectedly'), {
      name: 'PostgresError',
      code: 'CONNECTION_CLOSED',
    });
    const wrapped = new Error(
      'Failed query: select "id" from "session" where "id" in ($1)\nparams: secret-session-token',
      { cause },
    );

    expect(safeErrorFields(wrapped)).toEqual({
      error: 'Database query failed.',
      errorName: 'DatabaseError',
      errorCode: 'CONNECTION_CLOSED',
    });
  });

  it('keeps only approved driver codes through nested causes and plain driver records', async () => {
    const value = 'syntheticsecret';
    const cause = { code: '28P01', detail: value, query: value, parameters: [value] };
    const wrapped = new Error(value, {
      cause: Object.assign(new Error(value, { cause }), {
        query: value,
        params: [value],
      }),
    });
    const safe = {
      error: 'Database query failed.',
      errorName: 'DatabaseError',
      errorCode: '28P01',
    };
    expect(safeErrorFields(wrapped)).toEqual(safe);
    const thrown = await withDatabaseLogBoundary(() => Promise.reject(wrapped)).catch(
      (error: Error) => error,
    );
    expect(safeErrorFields(thrown)).toEqual(safe);
    expect(thrown.cause).toBeUndefined();
    expect(JSON.stringify(thrown)).not.toContain(value);
    cause.code = 'SHORT';
    expect(safeErrorFields(wrapped)).toEqual({ error: safe.error, errorName: safe.errorName });
    expect(safeErrorFields({ code: '28P01', detail: value })).toEqual(safe);
    const inherited = Object.create({ name: 'PostgresError' });
    expect(safeErrorFields(Object.assign(inherited, { message: value, code: 'SHORT' }))).toEqual({
      error: safe.error,
      errorName: safe.errorName,
    });
    const aggregate = new AggregateError(
      [new Error(value), { code: '28P01', detail: value }],
      value,
    );
    expect(safeErrorFields(aggregate)).toEqual(safe);
    expect(safeErrorFields({ code: 'P0001', detail: value })).toEqual({
      error: safe.error,
      errorName: safe.errorName,
    });
    const unrelated = new TypeError('unrelated');
    await expect(withDatabaseLogBoundary(() => Promise.reject(unrelated))).rejects.toBe(unrelated);
  });

  it('redacts credentials, emails and long mixed tokens from a plain error', () => {
    const fields = safeErrorFields(
      new Error(
        'Request postgres://orbit:secret@example.test/db for person@example.test and token abcdefghijklmnopqrstuvwx1234 failed',
      ),
    );

    expect(fields.error).toBe(
      'Request postgres://[redacted]@example.test/db for [redacted-email] and token [redacted] failed',
    );
  });

  it('sanitizes the error name and code as well as the message', () => {
    const error = Object.assign(new Error('Safe message'), {
      name: 'person@example.test',
      code: 'abcdefghijklmnopqrstuvwx1234',
    });

    expect(safeErrorFields(error)).toEqual({
      error: 'Safe message',
      errorName: '[redacted-email]',
      errorCode: '[redacted]',
    });
  });

  it('bounds an unknown error before it reaches the platform logger', () => {
    expect(safeErrorFields('x'.repeat(1_000)).error).toHaveLength(500);
  });
});
