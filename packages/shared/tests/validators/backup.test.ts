import { describe, expect, it } from 'bun:test';
import {
  type BackupManifest,
  backupManifestSchema,
  CURRENT_BACKUP_FORMAT_VERSION,
  extractBackupConfiguration,
  isAllowedBackupConfigKey,
  isForbiddenBackupConfigKey,
  validateConfigurationSafety,
} from '../../src/validators/backup.ts';

describe('backupManifestSchema', () => {
  const validManifest: BackupManifest = {
    formatVersion: CURRENT_BACKUP_FORMAT_VERSION,
    orbitVersion: '0.1.0',
    sourceRevision: 'abc123def456',
    imageDigests: {
      web: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    databaseVersion: 'PostgreSQL 18.6 on x86_64-pc-linux-gnu',
    createdAt: '2026-09-08T12:00:00.000Z',
    migrationLedger: [
      {
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        createdAt: '1786217938315',
      },
    ],
    configuration: {
      NEXT_PUBLIC_APP_URL: 'https://orbit.example.com',
      EMAIL_FROM: 'Orbit <orbit@example.com>',
    },
    checksums: {
      databaseDump: {
        file: 'database.dump',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        bytes: 1024,
      },
      objects: [
        {
          key: 'org_123/issue/att_456/file.png',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          bytes: 2048,
          contentType: 'image/png',
        },
      ],
    },
    counts: {
      workspaces: 1,
      users: 5,
      attachments: 1,
      issues: 10,
    },
    encryption: {
      enabled: false,
    },
    metadata: {
      generator: 'orbit-backup-create',
    },
  };

  it('validates a complete valid manifest', () => {
    const parsed = backupManifestSchema.parse(validManifest);
    expect(parsed.formatVersion).toBe(CURRENT_BACKUP_FORMAT_VERSION);
    expect(parsed.checksums.objects.length).toBe(1);
    expect(parsed.counts.workspaces).toBe(1);
  });

  it('rejects an invalid format version', () => {
    expect(() =>
      backupManifestSchema.parse({
        ...validManifest,
        formatVersion: '2.0',
      }),
    ).toThrow();
  });

  it('rejects non-hex sha256 checksums', () => {
    expect(() =>
      backupManifestSchema.parse({
        ...validManifest,
        checksums: {
          ...validManifest.checksums,
          databaseDump: {
            ...validManifest.checksums.databaseDump,
            sha256: 'not-a-valid-sha256-hash',
          },
        },
      }),
    ).toThrow();
  });

  it('rejects negative counts', () => {
    expect(() =>
      backupManifestSchema.parse({
        ...validManifest,
        counts: {
          ...validManifest.counts,
          workspaces: -1,
        },
      }),
    ).toThrow();
  });
});

describe('configuration safety and extraction', () => {
  it('correctly classifies allowed and forbidden keys', () => {
    expect(isAllowedBackupConfigKey('NEXT_PUBLIC_APP_URL')).toBe(true);
    expect(isAllowedBackupConfigKey('EMAIL_FROM')).toBe(true);
    expect(isAllowedBackupConfigKey('BETTER_AUTH_SECRET')).toBe(false);

    expect(isForbiddenBackupConfigKey('BETTER_AUTH_SECRET')).toBe(true);
    expect(isForbiddenBackupConfigKey('DATABASE_PASSWORD')).toBe(true);
    expect(isForbiddenBackupConfigKey('S3_SECRET_ACCESS_KEY')).toBe(true);
    expect(isForbiddenBackupConfigKey('GITHUB_APP_PRIVATE_KEY')).toBe(true);
    expect(isForbiddenBackupConfigKey('NEXT_PUBLIC_APP_URL')).toBe(false);
  });

  it('extracts only allowed non-empty configuration keys', () => {
    const env = {
      NEXT_PUBLIC_APP_URL: 'https://orbit.example.com',
      EMAIL_FROM: 'orbit@example.com',
      BETTER_AUTH_SECRET: 'super-secret-value-12345',
      DATABASE_URL: 'postgres://orbit:pass@localhost:5432/orbit',
      S3_BUCKET: 'orbit-uploads',
      ALLOWED_EMAIL_DOMAINS: '',
      UNKNOWN_VAR: 'value',
    };
    const extracted = extractBackupConfiguration(env);
    expect(extracted).toEqual({
      NEXT_PUBLIC_APP_URL: 'https://orbit.example.com',
      EMAIL_FROM: 'orbit@example.com',
      S3_BUCKET: 'orbit-uploads',
    });
    expect(extracted['BETTER_AUTH_SECRET']).toBeUndefined();
    expect(extracted['DATABASE_URL']).toBeUndefined();
    expect(extracted['UNKNOWN_VAR']).toBeUndefined();
  });

  it('throws when forbidden keys are passed to validateConfigurationSafety', () => {
    expect(() =>
      validateConfigurationSafety({
        BETTER_AUTH_SECRET: 'secret',
      }),
    ).toThrow();
  });
});
