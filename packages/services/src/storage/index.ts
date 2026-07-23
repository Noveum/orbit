import { validationFailed } from '@orbit/shared';
import { S3StorageDriver } from './s3.ts';
import type { StorageDriver } from './types.ts';

export { assertSafeKey, FILE_ROUTE } from './key.ts';
export { type S3Config, S3StorageDriver, s3ConfigSchema } from './s3.ts';
export {
  STORAGE_KINDS,
  type StorageDriver,
  type StorageKind,
  type StoredObject,
  type UploadTarget,
} from './types.ts';
export {
  kindOf,
  sanitizeFileName,
  storageKeyFor,
  type UploadCandidate,
  uploadCandidateSchema,
  type ValidatedUpload,
  validateUpload,
} from './validate.ts';

let cachedDriver: StorageDriver | null = null;

export function storageDriver(): StorageDriver {
  if (cachedDriver === null) cachedDriver = createStorageDriver();
  return cachedDriver;
}

export function createStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const accessKeyId = readEnv(env, 'S3_ACCESS_KEY_ID');
  const secretAccessKey = readEnv(env, 'S3_SECRET_ACCESS_KEY');
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
    throw validationFailed(
      'Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the ambient AWS credentials.',
    );
  }
  const endpoint = readEnv(env, 'S3_ENDPOINT');
  return new S3StorageDriver({
    bucket: requireEnv(env, 'S3_BUCKET'),
    region: readEnv(env, 'S3_REGION') ?? 'us-east-1',
    ...(accessKeyId === undefined ? {} : { accessKeyId }),
    ...(secretAccessKey === undefined ? {} : { secretAccessKey }),
    ...(endpoint === undefined ? {} : { endpoint }),
  });
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = readEnv(env, name);
  if (value === undefined) throw validationFailed(`${name} is required to reach object storage.`);
  return value;
}
