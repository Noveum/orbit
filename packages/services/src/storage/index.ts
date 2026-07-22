import { validationFailed } from '@orbit/shared';
import { DEFAULT_LOCAL_DIR, LocalStorageDriver } from './local.ts';
import { S3StorageDriver } from './s3.ts';
import type { StorageDriver } from './types.ts';

export { assertSafeKey, DEFAULT_LOCAL_DIR, LOCAL_FILE_ROUTE, LocalStorageDriver } from './local.ts';
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

export function createStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const driver = readEnv(env, 'STORAGE_DRIVER') ?? 'local';
  if (driver === 'local') {
    return new LocalStorageDriver(readEnv(env, 'STORAGE_LOCAL_DIR') ?? DEFAULT_LOCAL_DIR);
  }
  if (driver === 's3') {
    const endpoint = readEnv(env, 'S3_ENDPOINT');
    return new S3StorageDriver({
      bucket: requireEnv(env, 'S3_BUCKET'),
      region: readEnv(env, 'S3_REGION') ?? 'us-east-1',
      accessKeyId: requireEnv(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv(env, 'S3_SECRET_ACCESS_KEY'),
      ...(endpoint === undefined ? {} : { endpoint }),
    });
  }
  throw validationFailed(`Unknown STORAGE_DRIVER "${driver}". Use "local" or "s3".`);
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = readEnv(env, name);
  if (value === undefined) throw validationFailed(`${name} is required when STORAGE_DRIVER is s3.`);
  return value;
}
