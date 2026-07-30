import { describe, expect, it } from 'bun:test';
import { multiplexesConnections } from './client.ts';

const HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';

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
