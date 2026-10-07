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
  readonly encrypt?: boolean | undefined;
  readonly encryptionKey?: string | undefined;
  readonly encryptionKeyFile?: string | undefined;
  readonly encryptionCommand?: string | undefined;
  readonly encryptionKeyId?: string | undefined;
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
    readonly plaintextSha256?: string | undefined;
    readonly plaintextBytes?: number | undefined;
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
  readonly encryptionKey?: string | undefined;
  readonly encryptionKeyFile?: string | undefined;
  readonly encryptionCommand?: string | undefined;
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
  readonly plaintextSha256?: string | undefined;
  readonly plaintextBytes?: number | undefined;
}

export interface RestoreStorageOptions {
  readonly objectsDir: string;
  readonly expectedObjects: readonly RestoreStorageObjectEntry[];
  readonly driver: StorageDriver;
  readonly signal?: AbortSignal | undefined;
  readonly decrypt?: ((data: Buffer) => Buffer) | undefined;
}

export interface RestoreStorageResult {
  readonly uploadedCount: number;
  readonly verifiedCount: number;
}

export interface RecoveryDrillAttachmentRecord {
  readonly id: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content: Buffer;
}

export interface RecoveryDrillRepresentativeData {
  readonly organizationId: string;
  readonly adminUserId: string;
  readonly memberUserId: string;
  readonly revokedUserId: string;
  readonly teamId: string;
  readonly projectId: string;
  readonly issueId: string;
  readonly commentId: string;
  readonly docId: string;
  readonly activeGrantId: string;
  readonly revokedGrantId: string;
  readonly attachments: readonly RecoveryDrillAttachmentRecord[];
}

export interface RecoveryDrillMetrics {
  readonly backupDurationMs: number;
  readonly restoreDurationMs: number;
  readonly backupSizeBytes: number;
  readonly objectsCount: number;
  readonly objectsTotalBytes: number;
  readonly databaseDumpSizeBytes: number;
  readonly orbitVersion: string;
  readonly sourceRevision: string;
  readonly databaseVersion: string;
  readonly formatVersion: string;
  readonly encryptionAlgorithm: string;
  readonly attachmentsVerifiedCount: number;
  readonly valid: boolean;
}

export interface RecoveryDrillOptions {
  readonly databaseUrl: string;
  readonly destinationDir?: string | undefined;
  readonly encryptionKey?: string | undefined;
  readonly redisUrl?: string | undefined;
  readonly skipRedisCheck?: boolean | undefined;
  readonly storageDriver?: StorageDriver | undefined;
  readonly migrationsFolder?: string | undefined;
  readonly cleanDestination?: boolean | undefined;
}

export interface RecoveryDrillResult {
  readonly success: boolean;
  readonly metrics: RecoveryDrillMetrics;
  readonly errors: readonly string[];
  readonly representativeData: RecoveryDrillRepresentativeData;
}

export type UpgradeScenarioId =
  | 'fresh_install'
  | 'direct_upgrade'
  | 'backup_restore_upgrade'
  | 'direct_restore_current'
  | 'interrupted_migration_repair'
  | 'application_rollback'
  | 'unsafe_rollback_refusal';

export interface UpgradeScenarioResult {
  readonly id: UpgradeScenarioId;
  readonly name: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly error?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;
}

export interface UpgradeMatrixOptions {
  readonly databaseUrl: string;
  readonly migrationsFolder?: string | undefined;
  readonly scenario?: UpgradeScenarioId | undefined;
  readonly storageDriver?: StorageDriver | undefined;
  readonly skipDestructive?: boolean | undefined;
}

export interface UpgradeMatrixResult {
  readonly allPassed: boolean;
  readonly scenarios: readonly UpgradeScenarioResult[];
  readonly totalDurationMs: number;
}
