import { describe, expect, it } from 'bun:test';
import { multiplexesConnections, poolCacheKey } from '../src/client.ts';

const HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
const SESSION = `postgresql://user:pass@${HOST}:5432/postgres`;
const TRANSACTION = `postgresql://user:pass@${HOST}:6543/postgres`;

describe('multiplexesConnections', () => {
  it('detects the Supabase transaction pooler by port', () => {
    expect(multiplexesConnections(`postgresql://user:pass@${HOST}:6543/postgres`)).toBe(true);
  });

  it('leaves the session pooler alone', () => {
    expect(multiplexesConnections(`postgresql://user:pass@${HOST}:5432/postgres`)).toBe(false);
  });

  it('leaves a direct connection alone', () => {
    expect(multiplexesConnections('postgresql://user:pass@db.ref.supabase.co:5432/postgres')).toBe(
      false,
    );
  });

  it('leaves local development alone', () => {
    expect(multiplexesConnections('postgres://orbit:orbit@localhost:5434/orbit')).toBe(false);
  });

  it('ignores the port appearing elsewhere in the url', () => {
    expect(multiplexesConnections(`postgresql://user:6543@${HOST}:5432/postgres`)).toBe(false);
    expect(multiplexesConnections(`postgresql://user:pass@${HOST}:5432/db6543`)).toBe(false);
  });

  it('survives a query string and sslmode', () => {
    expect(
      multiplexesConnections(`postgresql://user:pass@${HOST}:6543/postgres?sslmode=require`),
    ).toBe(true);
  });

  it('treats an unparseable connection string as not multiplexed', () => {
    expect(multiplexesConnections('not a url')).toBe(false);
    expect(multiplexesConnections('')).toBe(false);
  });
});

describe('poolCacheKey', () => {
  it('matches when every connection option matches', () => {
    expect(poolCacheKey(SESSION, 10, true)).toBe(poolCacheKey(SESSION, 10, true));
  });

  it('differs when the url changes', () => {
    expect(poolCacheKey(SESSION, 10, true)).not.toBe(poolCacheKey(TRANSACTION, 10, true));
  });

  it('differs when the pool size changes', () => {
    expect(poolCacheKey(SESSION, 10, true)).not.toBe(poolCacheKey(SESSION, 1, true));
  });

  it('differs when the prepare mode changes', () => {
    expect(poolCacheKey(SESSION, 10, true)).not.toBe(poolCacheKey(SESSION, 10, false));
  });

  it('does not confuse a pool size with a url fragment', () => {
    expect(poolCacheKey(`${SESSION}1`, 1, true)).not.toBe(poolCacheKey(SESSION, 11, true));
  });
});
