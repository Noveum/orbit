import type { BackupManifest } from '@orbit/shared';
import type { StorageDriver } from '../storage/types.ts';

export interface BackupCreateOptions {
  readonly destinationDir: string;
  readonly databaseUrl?: string | undefined;
  readonly migrationsFolder?: string | undefined;
  readonly orbitVersion?: string | undefined;
  readonly sourceRevision?: string | undefined;
  readonly imageDigests?: Record<string, string> | undefined;
  readonly pgDumpPath?: string | undefined;
  readonly customMetadata?: Record<string, string> | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly storageDriver?: StorageDriver | undefined;
}

export interface BackupCreateResult {
  readonly backupId: string;
  readonly backupDir: string;
  readonly manifest: BackupManifest;
}

export interface DatabaseDumpResult {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly databaseVersion: string;
  readonly migrationLedger: readonly { readonly hash: string; readonly createdAt: string }[];
  readonly counts: {
    readonly workspaces: number;
    readonly users: number;
    readonly attachments: number;
    readonly issues: number;
  };
}

export interface StorageCaptureResult {
  readonly objects: readonly {
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly contentType: string;
  }[];
}

export interface AttachmentRecord {
  readonly id: string;
  readonly storage_key: string;
  readonly size: number;
  readonly content_type: string;
}

export interface BackupRestoreOptions {
  readonly backupPath: string;
  readonly confirmDestructiveRestoreTarget: string;
  readonly databaseUrl?: string | undefined;
  readonly migrationsFolder?: string | undefined;
  readonly pgRestorePath?: string | undefined;
  readonly currentOrbitVersion?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly storageDriver?: StorageDriver | undefined;
  readonly skipObjectRestore?: boolean | undefined;
  readonly skipRedisCheck?: boolean | undefined;
  readonly redisUrl?: string | undefined;
  readonly lockMaxLifetime?: number | null | undefined;
}

export interface BackupRestoreResult {
  readonly manifest: BackupManifest;
  readonly targetIdentity: string;
  readonly databaseRestored: boolean;
  readonly objectsReconciled: number;
  readonly validation: import('@orbit/shared').RestoreValidationResult;
}

export interface RestoreStorageObjectEntry {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType?: string | undefined;
}

export interface RestoreStorageOptions {
  readonly objectsDir: string;
  readonly expectedObjects: readonly RestoreStorageObjectEntry[];
  readonly driver: StorageDriver;
}

export interface RestoreStorageResult {
  readonly uploadedCount: number;
  readonly verifiedCount: number;
}
