import { describe, expect, it } from 'bun:test';
import { hash } from '@node-rs/argon2';
import { argon2 as native } from '../../../../src/lib/auth/argon2/native.ts';
import { parseArgon2Digest, argon2 as portable } from '../../../../src/lib/auth/argon2/portable.ts';

const PASSWORD = 'correct horse battery staple';
const UNICODE_PASSWORD = 'pässwörd \u{1F512} 密码';

const ARGON2D = 0;
const ARGON2I = 1;
const ARGON2ID = 2;

describe('portable argon2 against hashes the native module produced', () => {
  it('verifies a digest written with the production parameters', async () => {
    const digest = await native.hash(PASSWORD);
    expect(digest.startsWith('$argon2id$v=19$m=65536,t=2,p=1$')).toBe(true);
    expect(await portable.verify(digest, PASSWORD)).toBe(true);
    expect(await portable.verify(digest, `${PASSWORD} `)).toBe(false);
  });

  it('verifies a password with characters outside ASCII', async () => {
    const digest = await native.hash(UNICODE_PASSWORD);
    expect(await portable.verify(digest, UNICODE_PASSWORD)).toBe(true);
    expect(await portable.verify(digest, 'passwörd')).toBe(false);
  });

  it('verifies every argon2 variant and non default costs', async () => {
    for (const algorithm of [ARGON2D, ARGON2I, ARGON2ID]) {
      const digest = await hash(PASSWORD, {
        algorithm,
        memoryCost: 19456,
        timeCost: 3,
        parallelism: 2,
        outputLen: 24,
      });
      expect(await portable.verify(digest, PASSWORD)).toBe(true);
      expect(await portable.verify(digest, 'nope')).toBe(false);
    }
  });

  it('verifies a digest written by the runtime that came before the native module', async () => {
    const legacy = await Bun.password.hash(PASSWORD, { algorithm: 'argon2id' });
    expect(await portable.verify(legacy, PASSWORD)).toBe(true);
    expect(await portable.verify(legacy, 'nope')).toBe(false);
  });

  it('verifies a digest that carries a secret free version 16 header', async () => {
    const digest = await hash(PASSWORD, { algorithm: ARGON2ID, version: 0, memoryCost: 8192 });
    expect(digest.includes('v=16')).toBe(true);
    expect(await portable.verify(digest, PASSWORD)).toBe(true);
  });
});

describe('portable argon2 hashing', () => {
  it('writes a digest the native module verifies', async () => {
    const digest = await portable.hash(PASSWORD);
    expect(digest.startsWith('$argon2id$v=19$m=65536,t=2,p=1$')).toBe(true);
    expect(await native.verify(digest, PASSWORD)).toBe(true);
    expect(await native.verify(digest, 'nope')).toBe(false);
  });

  it('salts every digest', async () => {
    expect(await portable.hash(PASSWORD)).not.toBe(await portable.hash(PASSWORD));
  });
});

describe('portable argon2 digest parsing', () => {
  it('rejects digests it cannot trust', async () => {
    const digest = await native.hash(PASSWORD);
    const [, variant, version, costs, salt, key] = digest.split('$');
    const malformed = [
      '',
      'not-a-digest',
      `$bcrypt$${version}$${costs}$${salt}$${key}`,
      `$${variant}$v=99$${costs}$${salt}$${key}`,
      `$${variant}$${version}$m=65536,t=2$${salt}$${key}`,
      `$${variant}$${version}$m=65536,t=2,p=1,keyid=abc$${salt}$${key}`,
      `$${variant}$${version}$m=0,t=2,p=1$${salt}$${key}`,
      `$${variant}$${version}$m=99999999999,t=2,p=1$${salt}$${key}`,
      `$${variant}$${version}$${costs}$!!!$${key}`,
      `$${variant}$${version}$${costs}$${salt}$`,
      `$${variant}$${version}$${costs}$${salt}$${key}$extra`,
    ];
    for (const candidate of malformed) {
      expect(parseArgon2Digest(candidate)).toBeNull();
      expect(await portable.verify(candidate, PASSWORD)).toBe(false);
    }
  });

  it('reads the parameters out of a valid digest', async () => {
    const parsed = parseArgon2Digest(await native.hash(PASSWORD));
    expect(parsed).toMatchObject({
      variant: 'argon2id',
      version: 19,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    });
    expect(parsed?.salt.length).toBe(16);
    expect(parsed?.hash.length).toBe(32);
  });
});
