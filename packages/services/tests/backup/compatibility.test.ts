import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type { BackupManifest } from '@orbit/shared';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { verifyBackupCompatibility } from '../../src/backup/compatibility.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

function createValidTestManifest(): BackupManifest {
  const committed = readMigrationFiles({ migrationsFolder: MIGRATIONS });
  const ledger = committed.map((m) => ({
    hash: m.hash,
    createdAt: String(m.folderMillis),
  }));

  return {
    formatVersion: '1.0.0',
    orbitVersion: '0.1.0',
    sourceRevision: 'test-revision',
    imageDigests: {},
    databaseVersion: 'PostgreSQL 16.4',
    createdAt: new Date().toISOString(),
    migrationLedger: ledger,
    configuration: {},
    checksums: {
      databaseDump: {
        file: 'database.dump',
        sha256: 'a'.repeat(64),
        bytes: 1024,
      },
      objects: [],
    },
    counts: {
      workspaces: 1,
      users: 1,
      attachments: 0,
      issues: 0,
    },
    encryption: {
      enabled: false,
    },
    metadata: {},
  };
}

describe('verifyBackupCompatibility', () => {
  it('accepts manifest with matching migration ledger and format version', () => {
    const manifest = createValidTestManifest();
    const result = verifyBackupCompatibility(manifest, MIGRATIONS);
    expect(result.formatCompatible).toBe(true);
    expect(result.ledgerCompatible).toBe(true);
    expect(result.pendingMigrationsCount).toBe(0);
  });

  it('accepts manifest with a prefix of migrations and reports pending count', () => {
    const manifest = createValidTestManifest();
    const partialLedger = manifest.migrationLedger.slice(0, 5);
    const partialManifest = {
      ...manifest,
      migrationLedger: partialLedger,
    };

    const result = verifyBackupCompatibility(partialManifest, MIGRATIONS);
    expect(result.formatCompatible).toBe(true);
    expect(result.ledgerCompatible).toBe(true);
    expect(result.pendingMigrationsCount).toBe(manifest.migrationLedger.length - 5);
  });

  it('rejects unsupported future format version', () => {
    const manifest = createValidTestManifest();
    const futureManifest = {
      ...manifest,
      formatVersion: '2.0.0' as '1.0.0',
    };
    expect(() => verifyBackupCompatibility(futureManifest, MIGRATIONS)).toThrow(
      /Unsupported backup format version "2.0.0"/,
    );
  });

  it('refuses restore when backup has more migrations than current release (downgrade prevention)', () => {
    const manifest = createValidTestManifest();
    const extraRow = { hash: 'extra-future-hash', createdAt: '9999999999999' };
    const futureManifest = {
      ...manifest,
      migrationLedger: [...manifest.migrationLedger, extraRow],
    };

    expect(() => verifyBackupCompatibility(futureManifest, MIGRATIONS)).toThrow(
      /unsupported downgrade/,
    );
  });

  it('rejects manifest when migration hash differs from committed migration', () => {
    const manifest = createValidTestManifest();
    const corruptedLedger = manifest.migrationLedger.map((row, idx) =>
      idx === 0 ? { ...row, hash: 'corrupted-hash-xyz' } : row,
    );
    const corruptedManifest = {
      ...manifest,
      migrationLedger: corruptedLedger,
    };

    expect(() => verifyBackupCompatibility(corruptedManifest, MIGRATIONS)).toThrow(
      /does not match committed migration file in this release/,
    );
  });
});
