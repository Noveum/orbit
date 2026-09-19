import { z } from 'zod';
import { validationFailed } from '../errors/index.ts';

export const CURRENT_BACKUP_FORMAT_VERSION = '1.0.0';
export const MIN_SUPPORTED_BACKUP_FORMAT_VERSION = '1.0.0';
export const MAX_SUPPORTED_BACKUP_FORMAT_VERSION = '1.0.0';

export const ALLOWED_BACKUP_CONFIG_KEYS = [
  'ALLOWED_EMAIL_DOMAINS',
  'BETTER_AUTH_URL',
  'DATABASE_PREPARED_STATEMENTS',
  'EMAIL_FROM',
  'NEXT_PUBLIC_APP_URL',
  'S3_BUCKET',
  'S3_REGION',
] as const;

export type AllowedBackupConfigKey = (typeof ALLOWED_BACKUP_CONFIG_KEYS)[number];

const FORBIDDEN_SECRET_PATTERNS = [
  /secret/i,
  /password/i,
  /token/i,
  /key/i,
  /credential/i,
  /private/i,
] as const;

export const backupMigrationLedgerRowSchema = z.object({
  hash: z.string().min(1),
  createdAt: z.string().min(1),
});

export type BackupMigrationLedgerRow = z.infer<typeof backupMigrationLedgerRowSchema>;

export const backupDatabaseDumpSchema = z.object({
  file: z.string().min(1),
  sha256: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/i),
  bytes: z.number().int().nonnegative(),
});

export type BackupDatabaseDump = z.infer<typeof backupDatabaseDumpSchema>;

export const backupObjectEntrySchema = z.object({
  key: z.string().min(1),
  sha256: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/i),
  bytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});

export type BackupObjectEntry = z.infer<typeof backupObjectEntrySchema>;

export const backupCountsSchema = z.object({
  workspaces: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  attachments: z.number().int().nonnegative(),
  issues: z.number().int().nonnegative(),
});

export type BackupCounts = z.infer<typeof backupCountsSchema>;

export const backupEncryptionSchema = z.object({
  enabled: z.boolean(),
  algorithm: z.enum(['aes-256-gcm']).optional(),
  keyId: z.string().optional(),
});

export type BackupEncryption = z.infer<typeof backupEncryptionSchema>;

export const backupManifestSchema = z.object({
  formatVersion: z.literal(CURRENT_BACKUP_FORMAT_VERSION),
  orbitVersion: z.string().min(1),
  sourceRevision: z.string().min(1),
  imageDigests: z.record(z.string(), z.string()).default({}),
  databaseVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  migrationLedger: z.array(backupMigrationLedgerRowSchema),
  configuration: z.record(z.string(), z.string()).default({}),
  checksums: z.object({
    databaseDump: backupDatabaseDumpSchema,
    objects: z.array(backupObjectEntrySchema),
  }),
  counts: backupCountsSchema,
  encryption: backupEncryptionSchema,
  metadata: z.record(z.string(), z.string()).default({}),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function isAllowedBackupConfigKey(key: string): key is AllowedBackupConfigKey {
  return (ALLOWED_BACKUP_CONFIG_KEYS as readonly string[]).includes(key);
}

export function isForbiddenBackupConfigKey(key: string): boolean {
  if (isAllowedBackupConfigKey(key)) return false;
  return FORBIDDEN_SECRET_PATTERNS.some((pattern) => pattern.test(key));
}

export function extractBackupConfiguration(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ALLOWED_BACKUP_CONFIG_KEYS) {
    const value = env[key]?.trim();
    if (value !== undefined && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
}

export function validateConfigurationSafety(config: Record<string, string>): void {
  for (const key of Object.keys(config)) {
    if (!isAllowedBackupConfigKey(key)) {
      throw validationFailed(`Configuration key "${key}" is not permitted in backup manifest.`);
    }
  }
}

export const restoreTargetIdentitySchema = z.object({
  host: z.string().min(1),
  port: z.string().min(1),
  database: z.string().min(1),
  bucket: z.string().optional(),
  identity: z.string().min(1),
});

export type RestoreTargetIdentity = z.infer<typeof restoreTargetIdentitySchema>;

export function computeRestoreTargetIdentity(
  databaseUrl: string,
  bucket?: string | undefined,
): RestoreTargetIdentity {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw validationFailed('Invalid database connection URL for restore target.', { cause: error });
  }

  const host = parsed.hostname.toLowerCase();
  const port = parsed.port.length > 0 ? parsed.port : '5432';
  const database = parsed.pathname.replace(/^\//, '');
  const trimmedBucket = bucket?.trim();

  if (host.length === 0 || database.length === 0) {
    throw validationFailed('DATABASE_URL must include host and database name for restore target.');
  }

  const identity =
    trimmedBucket !== undefined && trimmedBucket.length > 0
      ? `${host}:${port}/db/${database}#bucket:${trimmedBucket}`
      : `${host}:${port}/db/${database}`;

  return {
    host,
    port,
    database,
    ...(trimmedBucket !== undefined && trimmedBucket.length > 0 ? { bucket: trimmedBucket } : {}),
    identity,
  };
}

export const restoreValidationResultSchema = z.object({
  valid: z.boolean(),
  migrationStatus: z.object({
    ledgerCount: z.number().int().nonnegative(),
    isBehind: z.boolean(),
    databaseVersion: z.string().min(1),
  }),
  integrity: z.object({
    organizations: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
    members: z.number().int().nonnegative(),
    teams: z.number().int().nonnegative(),
    issues: z.number().int().nonnegative(),
    docs: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(),
    mcpGrants: z.number().int().nonnegative(),
    referentialIntegrityPassed: z.boolean(),
  }),
  storage: z.object({
    checkedObjects: z.number().int().nonnegative(),
    missingObjects: z.number().int().nonnegative(),
    sizeMismatches: z.number().int().nonnegative(),
  }),
  auth: z.object({
    accountsCount: z.number().int().nonnegative(),
    bootstrapWindowClosed: z.boolean(),
  }),
  redis: z.object({
    tested: z.boolean(),
    emptyStartSafe: z.boolean(),
  }),
  durationMs: z.number().nonnegative(),
  errors: z.array(z.string()).default([]),
});

export type RestoreValidationResult = z.infer<typeof restoreValidationResultSchema>;

export const restoreRecoveryStateSchema = z.object({
  id: z.literal('readiness'),
  status: z.enum(['restoring', 'validation_failed', 'ready']),
  error: z.string().nullable().optional(),
  updatedAt: z.string(),
});

export type RestoreRecoveryState = z.infer<typeof restoreRecoveryStateSchema>;
