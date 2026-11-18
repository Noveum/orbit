import { argon2d, argon2i, argon2id } from '@noble/hashes/argon2.js';
import { ARGON2ID_PARAMETERS, type Argon2Hasher } from './parameters.ts';

const VARIANTS = { argon2d, argon2i, argon2id } as const;
const CURRENT_VERSION = 0x13;
const LEGACY_VERSION = 0x10;
const MAX_MEMORY_COST = 1_048_576;
const MAX_TIME_COST = 64;
const MAX_PARALLELISM = 16;
const MIN_SALT_BYTES = 8;
const MIN_HASH_BYTES = 4;

export interface ParsedArgon2Digest {
  readonly variant: keyof typeof VARIANTS;
  readonly version: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
}

type Costs = Pick<ParsedArgon2Digest, 'memoryCost' | 'timeCost' | 'parallelism'>;

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value) || value.length % 4 === 1) return null;
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '');
}

function boundedInteger(value: string | undefined, max: number): number | null {
  if (value === undefined || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= max ? parsed : null;
}

function parseCosts(segment: string): Costs | null {
  const entries = new Map<string, string>();
  for (const pair of segment.split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) return null;
    const name = pair.slice(0, separator);
    if (entries.has(name)) return null;
    entries.set(name, pair.slice(separator + 1));
  }
  if (entries.size !== 3) return null;
  const memoryCost = boundedInteger(entries.get('m'), MAX_MEMORY_COST);
  const timeCost = boundedInteger(entries.get('t'), MAX_TIME_COST);
  const parallelism = boundedInteger(entries.get('p'), MAX_PARALLELISM);
  if (memoryCost === null || timeCost === null || parallelism === null) return null;
  return { memoryCost, timeCost, parallelism };
}

function parseVersion(segment: string): number | null {
  const match = /^v=(\d{1,3})$/.exec(segment);
  if (match === null) return null;
  const version = Number(match[1]);
  return version === CURRENT_VERSION || version === LEGACY_VERSION ? version : null;
}

export function parseArgon2Digest(digest: string): ParsedArgon2Digest | null {
  const segments = digest.split('$');
  if (segments[0] !== '') return null;
  const variant = segments[1];
  if (variant !== 'argon2d' && variant !== 'argon2i' && variant !== 'argon2id') return null;
  const versioned = segments.length === 6;
  if (!versioned && segments.length !== 5) return null;
  const offset = versioned ? 3 : 2;
  const version = versioned ? parseVersion(segments[2] ?? '') : LEGACY_VERSION;
  const costs = parseCosts(segments[offset] ?? '');
  const salt = decodeBase64(segments[offset + 1] ?? '');
  const hash = decodeBase64(segments[offset + 2] ?? '');
  if (version === null || costs === null || salt === null || hash === null) return null;
  if (salt.length < MIN_SALT_BYTES || hash.length < MIN_HASH_BYTES) return null;
  return { variant, version, ...costs, salt, hash };
}

function equalInConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function hash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(ARGON2ID_PARAMETERS.saltLength));
  const derived = argon2id(password, salt, {
    m: ARGON2ID_PARAMETERS.memoryCost,
    t: ARGON2ID_PARAMETERS.timeCost,
    p: ARGON2ID_PARAMETERS.parallelism,
    dkLen: ARGON2ID_PARAMETERS.outputLength,
    version: CURRENT_VERSION,
  });
  const costs = [
    `m=${ARGON2ID_PARAMETERS.memoryCost}`,
    `t=${ARGON2ID_PARAMETERS.timeCost}`,
    `p=${ARGON2ID_PARAMETERS.parallelism}`,
  ].join(',');
  return Promise.resolve(
    `$argon2id$v=${CURRENT_VERSION}$${costs}$${encodeBase64(salt)}$${encodeBase64(derived)}`,
  );
}

function verify(digest: string, password: string): Promise<boolean> {
  const parsed = parseArgon2Digest(digest);
  if (parsed === null) return Promise.resolve(false);
  const derived = VARIANTS[parsed.variant](password, parsed.salt, {
    m: parsed.memoryCost,
    t: parsed.timeCost,
    p: parsed.parallelism,
    dkLen: parsed.hash.length,
    version: parsed.version,
  });
  return Promise.resolve(equalInConstantTime(derived, parsed.hash));
}

export const argon2: Argon2Hasher = { hash, verify };
