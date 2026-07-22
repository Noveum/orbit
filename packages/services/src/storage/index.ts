import { validationFailed } from '@orbit/shared';
import { LocalStorageDriver } from './local.ts';
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
  const driver = env['STORAGE_DRIVER'] ?? 'local';
  if (driver === 'local') return new LocalStorageDriver(env['STORAGE_LOCAL_DIR'] ?? './uploads');
  if (driver === 's3') {
    return new S3StorageDriver({
      bucket: env['S3_BUCKET'] ?? '',
      region: env['S3_REGION'] ?? 'us-east-1',
      accessKeyId: env['S3_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: env['S3_SECRET_ACCESS_KEY'] ?? '',
      ...(env['S3_ENDPOINT'] === undefined ? {} : { endpoint: env['S3_ENDPOINT'] }),
    });
  }
  throw validationFailed(`Unknown STORAGE_DRIVER "${driver}". Use "local" or "s3".`);
}
