import { argon2 } from '#argon2';

const PHC_ARGON2 = /^\$argon2(?:id|i|d)\$/;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  if (!PHC_ARGON2.test(digest)) return false;
  return await argon2.verify(digest, password);
}
