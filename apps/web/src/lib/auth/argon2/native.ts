import { hash, verify } from '@node-rs/argon2';
import { ARGON2ID_PARAMETERS, type Argon2Hasher } from './parameters.ts';

const ARGON2ID = 2;

export const argon2: Argon2Hasher = {
  hash: (password) =>
    hash(password, {
      algorithm: ARGON2ID,
      memoryCost: ARGON2ID_PARAMETERS.memoryCost,
      timeCost: ARGON2ID_PARAMETERS.timeCost,
      parallelism: ARGON2ID_PARAMETERS.parallelism,
      outputLen: ARGON2ID_PARAMETERS.outputLength,
    }),
  verify: (digest, password) => verify(digest, password),
};
