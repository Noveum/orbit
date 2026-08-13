import { describe, expect, it } from 'bun:test';
import { safeErrorFields } from '../../src/utils/error-fields.ts';

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
      error: 'Connection terminated unexpectedly',
      errorName: 'PostgresError',
      errorCode: 'CONNECTION_CLOSED',
    });
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
