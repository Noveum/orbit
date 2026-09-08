import { describe, expect, it } from 'bun:test';
import { parseDatabaseConnection } from '../../src/backup/database.ts';

describe('parseDatabaseConnection', () => {
  it('parses standard connection url', () => {
    const parsed = parseDatabaseConnection(
      'postgres://orbit_user:secret_pass@db.example.com:5433/orbit_db',
    );
    expect(parsed.host).toBe('db.example.com');
    expect(parsed.port).toBe('5433');
    expect(parsed.user).toBe('orbit_user');
    expect(parsed.password).toBe('secret_pass');
    expect(parsed.database).toBe('orbit_db');
  });

  it('defaults port to 5432 when omitted', () => {
    const parsed = parseDatabaseConnection('postgres://orbit_user@localhost/orbit');
    expect(parsed.port).toBe('5432');
    expect(parsed.password).toBeUndefined();
  });

  it('handles percent-encoded credentials properly', () => {
    const parsed = parseDatabaseConnection(
      'postgres://user%40domain:p%40ss%23word@127.0.0.1:5432/my_db',
    );
    expect(parsed.user).toBe('user@domain');
    expect(parsed.password).toBe('p@ss#word');
    expect(parsed.database).toBe('my_db');
  });

  it('throws on invalid connection url', () => {
    expect(() => parseDatabaseConnection('postgres:///empty_host')).toThrow();
  });
});
