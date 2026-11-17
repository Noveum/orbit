export const ARGON2ID_PARAMETERS = {
  memoryCost: 65536,
  timeCost: 2,
  parallelism: 1,
  outputLength: 32,
  saltLength: 16,
} as const;

export interface Argon2Hasher {
  hash(password: string): Promise<string>;
  verify(digest: string, password: string): Promise<boolean>;
}
