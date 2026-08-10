import { describe, expect, it } from 'bun:test';
import { poolCacheKey, resolvePreparedStatements } from '../src/client.ts';

const SESSION = 'postgresql://user:pass@db.example.com:5432/postgres';
const TRANSACTION = 'postgresql://user:pass@pool.example.com:6432/postgres';
const CLIENT_URL = new URL('../src/client.ts', import.meta.url).href;

async function constructedPrepareSetting(url: string, configured?: string): Promise<string> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: url,
    DATABASE_POOL_MAX: '1',
  };
  env['DATABASE_PREPARED_STATEMENTS'] = configured;
  const source = `const { pool } = await import(${JSON.stringify(CLIENT_URL)}); process.stdout.write(String(pool.options.prepare)); await pool.end();`;
  const child = Bun.spawn(['bun', '--eval', source], { env, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return stdout;
}

describe('resolvePreparedStatements', () => {
  it('disables prepared statements when the setting is absent', () => {
    expect(resolvePreparedStatements(SESSION, undefined)).toBe(false);
  });

  it('accepts the two explicit settings', () => {
    expect(resolvePreparedStatements(SESSION, 'true')).toBe(true);
    expect(resolvePreparedStatements(TRANSACTION, 'false')).toBe(false);
  });

  it('rejects ambiguous setting values', () => {
    expect(() => resolvePreparedStatements(SESSION, '')).toThrow('DATABASE_PREPARED_STATEMENTS');
    expect(() => resolvePreparedStatements(SESSION, '1')).toThrow('DATABASE_PREPARED_STATEMENTS');
    expect(() => resolvePreparedStatements(SESSION, 'TRUE')).toThrow(
      'DATABASE_PREPARED_STATEMENTS',
    );
  });

  it('rejects the postgres.js prepare query option', () => {
    expect(() => resolvePreparedStatements(`${SESSION}?prepare=false`, 'false')).toThrow(
      'DATABASE_PREPARED_STATEMENTS',
    );
    expect(() =>
      resolvePreparedStatements(`${SESSION}?sslmode=require&prepare=true`, 'true'),
    ).toThrow('DATABASE_PREPARED_STATEMENTS');
  });

  it('rejects encoded prepare query keys', () => {
    expect(() => resolvePreparedStatements(`${SESSION}?%70repare=false`, 'false')).toThrow(
      'DATABASE_PREPARED_STATEMENTS',
    );
  });

  it('allows a prepare-looking key prefixed by a second query marker', () => {
    expect(resolvePreparedStatements(`${SESSION}??prepare=false`, 'true')).toBe(true);
  });

  it('normalizes ignored url characters before checking the query', () => {
    for (const ignored of ['\t', '\n', '\r']) {
      expect(() =>
        resolvePreparedStatements(`${SESSION}?pre${ignored}pare=false`, 'false'),
      ).toThrow('DATABASE_PREPARED_STATEMENTS');
    }
  });

  it('strips url-edge controls and spaces before checking the query', () => {
    expect(() => resolvePreparedStatements(`\u0001${SESSION}?prepare\u0020`, 'false')).toThrow(
      'DATABASE_PREPARED_STATEMENTS',
    );
  });

  it('ignores prepare-looking text after the first fragment marker', () => {
    expect(resolvePreparedStatements(`${SESSION}#fragment?prepare=false`, 'true')).toBe(true);
    expect(
      resolvePreparedStatements(`${SESSION}?sslmode=require#fragment?prepare=true`, 'false'),
    ).toBe(false);
  });

  it('rejects percent-encoded commas in the host authority', () => {
    const url = 'postgresql://u:p@prepare%2Cevil/db?prepare,evil=false';
    expect(() => resolvePreparedStatements(url, 'false')).toThrow('percent-encoded comma');
  });

  it('allows percent-encoded commas outside the host authority', () => {
    const url =
      'postgresql://user%2Cname:pass@db.example.com/postgres%2Carchive?application_name=orbit%2Cworker';
    expect(resolvePreparedStatements(url, 'false')).toBe(false);
  });

  it('does not expose the database url in a query option error', () => {
    const urls = [
      'postgresql://sensitive-user:sensitive-password@secret.example/private?prepare=true',
      'postgresql://sensitive-user:sensitive-password@secret%2Chost/private?prepare,host=false',
    ];
    for (const url of urls) {
      let message = '';
      try {
        resolvePreparedStatements(url, 'false');
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain('sensitive-user');
      expect(message).not.toContain('sensitive-password');
      expect(message).not.toContain('secret');
      expect(message).not.toContain('private');
    }
  });

  it('leaves unrelated connection options alone', () => {
    expect(resolvePreparedStatements(`${TRANSACTION}?sslmode=require`, 'false')).toBe(false);
  });

  it('handles a long url with interior spaces within a bounded time', () => {
    const url = `${SESSION}/${' '.repeat(32_000)}x`;
    const startedAt = performance.now();

    expect(resolvePreparedStatements(url, 'false')).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  it('supports postgres.js multi-host urls', () => {
    const url =
      'postgresql://user:pass@pool-a.example:6432,pool-b.example:6432/postgres?sslmode=require';
    expect(resolvePreparedStatements(url, 'false')).toBe(false);
  });
});

describe('database pool construction', () => {
  it('uses the explicit setting instead of inferring support from the port', async () => {
    const url = 'postgresql://user:pass@pool.example.com:6543/postgres';
    expect(await constructedPrepareSetting(url, 'true')).toBe('true');
  });

  it('disables prepared statements by default on every port', async () => {
    expect(await constructedPrepareSetting(SESSION)).toBe('false');
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
