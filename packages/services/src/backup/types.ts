import type { BackupManifest } from '@orbit/shared';

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
