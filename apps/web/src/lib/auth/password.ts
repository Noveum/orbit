import { hash, verify } from '@node-rs/argon2';

const ARGON2ID = 2;
const PHC_ARGON2 = /^\$argon2(?:id|i|d)\$/;

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65536,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  if (!PHC_ARGON2.test(digest)) return false;
  return await verify(digest, password);
}
