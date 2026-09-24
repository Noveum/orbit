import { fileURLToPath } from 'node:url';
import {
  type BackupManifest,
  MAX_SUPPORTED_BACKUP_FORMAT_VERSION,
  MIN_SUPPORTED_BACKUP_FORMAT_VERSION,
  validationFailed,
} from '@orbit/shared';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export interface CompatibilityCheckResult {
  readonly formatCompatible: boolean;
  readonly ledgerCompatible: boolean;
  readonly pendingMigrationsCount: number;
}

export function verifyBackupCompatibility(
  manifest: BackupManifest,
  customMigrationsFolder?: string | undefined,
): CompatibilityCheckResult {
  if (
    manifest.formatVersion < MIN_SUPPORTED_BACKUP_FORMAT_VERSION ||
    manifest.formatVersion > MAX_SUPPORTED_BACKUP_FORMAT_VERSION
  ) {
    throw validationFailed(
      `Unsupported backup format version "${manifest.formatVersion}". Supported versions: ${MIN_SUPPORTED_BACKUP_FORMAT_VERSION} to ${MAX_SUPPORTED_BACKUP_FORMAT_VERSION}.`,
    );
  }

  const migrationsFolder =
    customMigrationsFolder ?? fileURLToPath(new URL('../../../db/drizzle', import.meta.url));
  const committedMigrations = readMigrationFiles({ migrationsFolder });

  if (manifest.migrationLedger.length > committedMigrations.length) {
    throw validationFailed(
      `Cannot restore backup: backup migration ledger contains ${manifest.migrationLedger.length} migrations, but this Orbit release only has ${committedMigrations.length} committed migrations (unsupported downgrade).`,
    );
  }

  for (const [index, row] of manifest.migrationLedger.entries()) {
    const committed = committedMigrations[index];
    if (committed === undefined || row.createdAt !== String(committed.folderMillis)) {
      throw validationFailed(
        `Backup migration ledger at index ${index} (${row.createdAt}) does not match committed migrations.`,
      );
    }
    if (row.hash !== committed.hash) {
      throw validationFailed(
        `Backup migration ledger hash for ${row.createdAt} does not match committed migration file in this release.`,
      );
    }
  }

  return {
    formatCompatible: true,
    ledgerCompatible: true,
    pendingMigrationsCount: committedMigrations.length - manifest.migrationLedger.length,
  };
}
