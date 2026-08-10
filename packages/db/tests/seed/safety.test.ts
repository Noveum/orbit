import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { assertSeedResetAllowed } from '../../src/seed/safety.ts';

const ALICE_FINGERPRINT = '2bd806c97f0e00af1a1fc3328fa763a9269723c8db8fac4f93af71db186d6e90';
const BOB_FINGERPRINT = '81b637d8fcd2c6da6359e6963113a1170de795e4b725b84d1e0b4cfd9ec58ce9';
const ORBIT_FINGERPRINT = '4fa1a13ac468ac495f3390e859d76d5e8ef49806815b45a21de7711bcc624194';
const ALICE_EMAIL_FINGERPRINT = 'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976';
const IPV6_DRIVER_MESSAGE =
  'DATABASE_URL cannot use an IPv6 host because the current database driver misparses bracketed IPv6 connection URLs.';

function thrownMessage(work: () => void): string {
  try {
    work();
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the seed safety guard to reject the target.');
}

async function runSeedCommand(
  databaseUrl: string,
  overrides: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const entrypoint = fileURLToPath(new URL('../../src/seed/index.ts', import.meta.url));
  const child = Bun.spawn([process.execPath, entrypoint], {
    env: { ...process.env, ...overrides, DATABASE_URL: databaseUrl },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe('assertSeedResetAllowed', () => {
  const defaultDockerTargets = [
    ['localhost', 'postgres://orbit:orbit@localhost:5434/orbit'],
    ['canonical IPv4 loopback', 'postgres://orbit:orbit@127.0.0.1:5434/orbit'],
    ['percent-encoded credentials', 'postgres://or%62it:or%62it@localhost:5434/orbit'],
  ] as const;

  for (const [name, databaseUrl] of defaultDockerTargets) {
    it(`allows the default Docker target through ${name} without confirmation`, () => {
      expect(() => assertSeedResetAllowed(databaseUrl, undefined)).not.toThrow();
    });
  }

  const loopbackTargetsRequiringConfirmation = [
    [
      'a production database through localhost',
      'postgres://alice:top-secret@localhost:5432/production',
      `localhost:5432/production:user-sha256:${ALICE_FINGERPRINT}`,
    ],
    [
      'a production database through canonical IPv4 loopback',
      'postgres://alice:top-secret@127.0.0.1:15432/production',
      `127.0.0.1:15432/production:user-sha256:${ALICE_FINGERPRINT}`,
    ],
    [
      'a noncanonical IPv4 loopback address',
      'postgres://orbit:orbit@127.42.0.1:5434/orbit',
      `127.42.0.1:5434/orbit:user-sha256:${ORBIT_FINGERPRINT}`,
    ],
    [
      'different credentials on the default address',
      'postgres://orbit:top-secret@localhost:5434/orbit',
      `localhost:5434/orbit:user-sha256:${ORBIT_FINGERPRINT}`,
    ],
  ] as const;

  for (const [name, databaseUrl, confirmation] of loopbackTargetsRequiringConfirmation) {
    it(`requires exact target confirmation for ${name}`, () => {
      expect(() => assertSeedResetAllowed(databaseUrl, undefined)).toThrow(
        `ORBIT_SEED_CONFIRM_TARGET=${confirmation}`,
      );
      expect(() => assertSeedResetAllowed(databaseUrl, confirmation)).not.toThrow();
    });
  }

  it('rejects a localhost target without an explicit port', () => {
    expect(() =>
      assertSeedResetAllowed('postgres://orbit:orbit@localhost/orbit', undefined),
    ).toThrow('DATABASE_URL must include an explicit port for a non-default db:seed target.');
  });

  it('rejects a localhost target without an explicit username', () => {
    expect(() =>
      assertSeedResetAllowed('postgres://:orbit@localhost:5434/orbit', undefined),
    ).toThrow('DATABASE_URL must include an explicit username for a non-default db:seed target.');
  });

  const ipv6Targets = [
    ['loopback', 'postgres://orbit:secret@[::1]:5432/orbit'],
    ['remote', 'postgres://alice:top-secret@[2001:db8::1]:5432/orbit'],
  ] as const;

  for (const [name, databaseUrl] of ipv6Targets) {
    it(`rejects an IPv6 ${name} target the current database driver cannot parse`, () => {
      const message = thrownMessage(() => assertSeedResetAllowed(databaseUrl, undefined));
      expect(message).toBe(IPV6_DRIVER_MESSAGE);
      expect(message).not.toContain('alice');
      expect(message).not.toContain('top-secret');
      expect(message).not.toContain('secret');
    });
  }

  it('allows a remote target only when confirmation exactly matches its credential-safe label', () => {
    expect(() =>
      assertSeedResetAllowed(
        'postgresql://alice:top-secret@DB.Example.com:5432/orbit?sslmode=require',
        `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
      ),
    ).not.toThrow();
  });

  it('allows ordinary percent encoding in database credentials', () => {
    expect(() =>
      assertSeedResetAllowed(
        'postgres://alice%40example.com:p%40ssword@db.example.com:5432/orbit',
        `db.example.com:5432/orbit:user-sha256:${ALICE_EMAIL_FINGERPRINT}`,
      ),
    ).not.toThrow();
  });

  it('binds confirmation to the exact decoded startup username', () => {
    const message = thrownMessage(() =>
      assertSeedResetAllowed(
        'postgres://bob:top-secret@db.example.com:5432/orbit',
        `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
      ),
    );

    expect(message).toContain(
      `ORBIT_SEED_CONFIRM_TARGET=db.example.com:5432/orbit:user-sha256:${BOB_FINGERPRINT}`,
    );
    expect(message).not.toContain('alice');
    expect(message).not.toContain('bob');
    expect(message).not.toContain('top-secret');
  });

  it('requires an explicit username for a remote target', () => {
    const message = thrownMessage(() =>
      assertSeedResetAllowed(
        'postgres://db.example.com:5432/orbit',
        `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
      ),
    );

    expect(message).toBe(
      'DATABASE_URL must include an explicit username for a non-default db:seed target.',
    );
    expect(message).not.toContain('alice');
  });

  it('rejects a remote target without an explicit port', () => {
    const message = thrownMessage(() =>
      assertSeedResetAllowed(
        'postgres://alice:top-secret@db.example.com/orbit',
        `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
      ),
    );

    expect(message).toBe(
      'DATABASE_URL must include an explicit port for a non-default db:seed target.',
    );
    expect(message).not.toContain('alice');
    expect(message).not.toContain('top-secret');
  });

  const dockerAliases = ['host.docker.internal', 'postgres'] as const;

  for (const hostname of dockerAliases) {
    it(`requires confirmation for the ${hostname} alias`, () => {
      expect(() =>
        assertSeedResetAllowed(`postgres://orbit:secret@${hostname}:5432/orbit`, undefined),
      ).toThrow(
        `ORBIT_SEED_CONFIRM_TARGET=${hostname}:5432/orbit:user-sha256:${ORBIT_FINGERPRINT}`,
      );
    });

    it(`accepts exact confirmation for the ${hostname} alias`, () => {
      expect(() =>
        assertSeedResetAllowed(
          `postgres://orbit:secret@${hostname}:5432/orbit`,
          `${hostname}:5432/orbit:user-sha256:${ORBIT_FINGERPRINT}`,
        ),
      ).not.toThrow();
    });
  }

  it('rejects a remote target without confirmation and never exposes credentials', () => {
    const message = thrownMessage(() =>
      assertSeedResetAllowed(
        'postgres://alice:top-secret@db.example.com:6543/orbit?sslmode=require',
        undefined,
      ),
    );

    expect(message).toContain(
      `ORBIT_SEED_CONFIRM_TARGET=db.example.com:6543/orbit:user-sha256:${ALICE_FINGERPRINT}`,
    );
    expect(message).not.toContain('alice');
    expect(message).not.toContain('top-secret');
  });

  it('rejects a remote target when confirmation is not the exact target label', () => {
    expect(() =>
      assertSeedResetAllowed('postgres://orbit:secret@db.example.com:5432/orbit', 'true'),
    ).toThrow(
      `ORBIT_SEED_CONFIRM_TARGET=db.example.com:5432/orbit:user-sha256:${ORBIT_FINGERPRINT}`,
    );
  });

  it('does not treat a local-looking remote hostname as local', () => {
    expect(() =>
      assertSeedResetAllowed('postgres://orbit:secret@localhost.example.com:5432/orbit', undefined),
    ).toThrow(
      `ORBIT_SEED_CONFIRM_TARGET=localhost.example.com:5432/orbit:user-sha256:${ORBIT_FINGERPRINT}`,
    );
  });

  it('does not treat invalid IPv4 text with a loopback prefix as local', () => {
    expect(() =>
      assertSeedResetAllowed('postgres://orbit:secret@127.999.999.999:5432/orbit', undefined),
    ).toThrow(
      `ORBIT_SEED_CONFIRM_TARGET=127.999.999.999:5432/orbit:user-sha256:${ORBIT_FINGERPRINT}`,
    );
  });

  const ambiguousAuthorities = [
    [
      'a literal comma host list',
      'postgres://alice:top-secret@db-a.example.com:5432,db-b.example.com:5432/orbit',
    ],
    [
      'an encoded comma host list',
      'postgres://alice:top-secret@db-a%2Cdb-b.example.com:5432/orbit',
    ],
    [
      'multiple literal credential separators',
      'postgres://alice:top-secret@db-a.example.com@db-b.example.com:5432/orbit',
    ],
    [
      'an encoded credential separator in the host',
      'postgres://alice:top-secret@db-a%40db-b.example.com:5432/orbit',
    ],
  ] as const;

  for (const [name, databaseUrl] of ambiguousAuthorities) {
    it(`rejects ${name} without exposing credentials`, () => {
      const message = thrownMessage(() =>
        assertSeedResetAllowed(databaseUrl, 'db-b.example.com:5432/orbit'),
      );
      expect(message).toBe(
        'DATABASE_URL must be a valid PostgreSQL connection URL with a database name before db:seed can reset it.',
      );
      expect(message).not.toContain('alice');
      expect(message).not.toContain('top-secret');
    });
  }

  const rawAuthorityControlCharacters = [
    ['a tab', '\t'],
    ['a line feed', '\n'],
    ['a carriage return', '\r'],
  ] as const;

  for (const [controlName, control] of rawAuthorityControlCharacters) {
    const malformedSchemes = [
      ['after the scheme colon', `postgres:${control}//alice:top-secret@db-a,db-b:5432/orbit`],
      [
        'between the authority slashes',
        `postgres:/${control}/alice:top-secret@db-a,db-b:5432/orbit`,
      ],
    ] as const;

    for (const [positionName, databaseUrl] of malformedSchemes) {
      it(`rejects ${controlName} ${positionName} before URL normalization`, () => {
        const message = thrownMessage(() =>
          assertSeedResetAllowed(
            databaseUrl,
            `db-a,db-b:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
          ),
        );
        expect(message).toBe(
          'DATABASE_URL must be a valid PostgreSQL connection URL with a database name before db:seed can reset it.',
        );
        expect(message).not.toContain('alice');
        expect(message).not.toContain('top-secret');
      });
    }
  }

  const targetChangingOptions = [
    'search_path=private',
    'options=-c%20search_path%3Dprivate',
    'database=other_database',
    'host=other.example.com',
  ] as const;

  for (const option of targetChangingOptions) {
    it(`rejects the target-changing ${option.split('=')[0]} option`, () => {
      const message = thrownMessage(() =>
        assertSeedResetAllowed(
          `postgres://alice:top-secret@db.example.com:5432/orbit?${option}`,
          `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
        ),
      );
      expect(message).toBe(
        'DATABASE_URL contains a connection option that can change the database or schema targeted by db:seed.',
      );
      expect(message).not.toContain('alice');
      expect(message).not.toContain('top-secret');
    });
  }

  const nulQueryOptions = [
    ['an injected search_path field in a value', 'application_name=orbit%00search_path%00private'],
    ['an injected database field in a value', 'application_name=orbit%00database%00production'],
    ['an injected field in a key', 'application_name%00search_path=private'],
  ] as const;

  for (const [name, option] of nulQueryOptions) {
    it(`rejects ${name} without exposing credentials`, () => {
      const message = thrownMessage(() =>
        assertSeedResetAllowed(
          `postgres://alice:top-secret@db.example.com:5432/orbit?${option}`,
          `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
        ),
      );
      expect(message).toBe('DATABASE_URL contains an unsafe NUL byte in a connection option.');
      expect(message).not.toContain('alice');
      expect(message).not.toContain('top-secret');
    });
  }

  const nulCredentialUrls = [
    [
      'a search_path field injected through the username',
      'postgres://alice%00search_path%00private:secret@db.example.com:5432/orbit',
    ],
    [
      'an options field injected through the username',
      'postgres://alice%00options%00-c%20search_path%3Dprivate:secret@db.example.com:5432/orbit',
    ],
    [
      'a database field injected through the password',
      'postgres://alice:secret%00database%00production@db.example.com:5432/orbit',
    ],
  ] as const;

  for (const [name, databaseUrl] of nulCredentialUrls) {
    it(`rejects ${name} without exposing credentials`, () => {
      const message = thrownMessage(() =>
        assertSeedResetAllowed(
          databaseUrl,
          `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
        ),
      );
      expect(message).toBe('DATABASE_URL contains an unsafe NUL byte in database credentials.');
      expect(message).not.toContain('alice');
      expect(message).not.toContain('secret');
      expect(message).not.toContain('private');
      expect(message).not.toContain('production');
    });
  }

  const malformedCredentialUrls = [
    ['username', 'postgres://alice%ZZ:top-secret@db.example.com:5432/orbit'],
    ['password', 'postgres://alice:top-secret%E0%A4%A@db.example.com:5432/orbit'],
  ] as const;

  for (const [field, databaseUrl] of malformedCredentialUrls) {
    it(`rejects malformed ${field} encoding without exposing credentials`, () => {
      const message = thrownMessage(() =>
        assertSeedResetAllowed(
          databaseUrl,
          `db.example.com:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
        ),
      );
      expect(message).toBe(
        'DATABASE_URL must be a valid PostgreSQL connection URL with a database name before db:seed can reset it.',
      );
      expect(message).not.toContain('alice');
      expect(message).not.toContain('top-secret');
    });
  }

  const invalidTargets = [
    ['a missing URL', undefined],
    ['a malformed URL', 'not-a-url?password=top-secret'],
    ['a URL with the wrong protocol', 'https://alice:top-secret@db.example.com:5432/orbit'],
    ['a URL missing its database path', 'postgres://alice:top-secret@db.example.com:5432'],
    ['a URL with an empty database path', 'postgres://alice:top-secret@db.example.com:5432/'],
  ] as const;

  for (const [name, databaseUrl] of invalidTargets) {
    it(`rejects ${name} without exposing input`, () => {
      const message = thrownMessage(() => assertSeedResetAllowed(databaseUrl, undefined));
      expect(message).toBe(
        'DATABASE_URL must be a valid PostgreSQL connection URL with a database name before db:seed can reset it.',
      );
      expect(message).not.toContain('alice');
      expect(message).not.toContain('top-secret');
    });
  }

  it('stops the seed command before reset begins for an unconfirmed remote target', async () => {
    const { exitCode, stdout, stderr } = await runSeedCommand(
      'postgres://alice:top-secret@db.example.invalid:5432/orbit?connect_timeout=1',
      { ORBIT_SEED_CONFIRM_TARGET: '' },
    );

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('Resetting database');
    expect(stderr).toContain(
      `ORBIT_SEED_CONFIRM_TARGET=db.example.invalid:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
    );
    expect(stderr).not.toContain('alice');
    expect(stderr).not.toContain('top-secret');
  });

  it('rejects a malformed command target without exposing its contents', async () => {
    const { exitCode, stdout, stderr } = await runSeedCommand('not-a-url?password=top-secret', {
      ORBIT_SEED_CONFIRM_TARGET: '',
    });

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('Resetting database');
    expect(stderr).toContain(
      'DATABASE_URL must be a valid PostgreSQL connection URL with a database name before db:seed can reset it.',
    );
    expect(stderr).not.toContain('top-secret');
  });

  it('stops before PGPORT can change an unported remote target', async () => {
    const { exitCode, stdout, stderr } = await runSeedCommand(
      'postgres://alice:top-secret@db.example.invalid/orbit',
      {
        ORBIT_SEED_CONFIRM_TARGET: `db.example.invalid:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
        PGPORT: '6543',
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('Resetting database');
    expect(stderr).toContain(
      'DATABASE_URL must include an explicit port for a non-default db:seed target.',
    );
    expect(stderr).not.toContain('alice');
    expect(stderr).not.toContain('top-secret');
  });

  it('stops before PGUSER can supply an unconfirmed remote username', async () => {
    const { exitCode, stdout, stderr } = await runSeedCommand(
      'postgres://db.example.invalid:5432/orbit',
      {
        ORBIT_SEED_CONFIRM_TARGET: `db.example.invalid:5432/orbit:user-sha256:${ALICE_FINGERPRINT}`,
        PGUSER: 'fallback-user',
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('Resetting database');
    expect(stderr).toContain(
      'DATABASE_URL must include an explicit username for a non-default db:seed target.',
    );
    expect(stderr).not.toContain('alice');
    expect(stderr).not.toContain('fallback-user');
  });
});
