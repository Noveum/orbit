import { describe, expect, it } from 'bun:test';
import {
  computeRestoreTargetIdentity,
  restoreRecoveryStateSchema,
  restoreTargetIdentitySchema,
  restoreValidationResultSchema,
} from '../../src/validators/backup.ts';

describe('restoreTargetIdentitySchema and computeRestoreTargetIdentity', () => {
  it('computes target identity for database URL without port or bucket', () => {
    const target = computeRestoreTargetIdentity('postgres://user:secret@db.example.com/orbit');
    expect(target.host).toBe('db.example.com');
    expect(target.port).toBe('5432');
    expect(target.database).toBe('orbit');
    expect(target.bucket).toBeUndefined();
    expect(target.identity).toBe('db.example.com:5432/orbit');
    expect(target.identity).not.toContain('secret');
    expect(target.identity).not.toContain('user');
    expect(restoreTargetIdentitySchema.safeParse(target).success).toBe(true);
  });

  it('computes target identity including custom port and bucket', () => {
    const target = computeRestoreTargetIdentity(
      'postgres://user:password@localhost:5434/orbit_test',
      'orbit-uploads-bucket',
    );
    expect(target.host).toBe('localhost');
    expect(target.port).toBe('5434');
    expect(target.database).toBe('orbit_test');
    expect(target.bucket).toBe('orbit-uploads-bucket');
    expect(target.identity).toBe('localhost:5434/orbit_test:orbit-uploads-bucket');
    expect(target.identity).not.toContain('password');
    expect(restoreTargetIdentitySchema.safeParse(target).success).toBe(true);
  });

  it('throws when URL is invalid or missing host or database', () => {
    expect(() => computeRestoreTargetIdentity('not-a-url')).toThrow();
    expect(() => computeRestoreTargetIdentity('postgres://')).toThrow();
  });
});

describe('restoreValidationResultSchema', () => {
  it('accepts a valid restore validation result', () => {
    const sample = {
      valid: true,
      migrationStatus: {
        ledgerCount: 29,
        isBehind: false,
        databaseVersion: 'PostgreSQL 16.4',
      },
      integrity: {
        organizations: 2,
        users: 5,
        members: 5,
        teams: 3,
        issues: 12,
        docs: 4,
        attachments: 2,
        mcpGrants: 1,
        referentialIntegrityPassed: true,
      },
      storage: {
        checkedObjects: 2,
        missingObjects: 0,
        sizeMismatches: 0,
      },
      auth: {
        accountsCount: 5,
        bootstrapWindowClosed: true,
      },
      redis: {
        tested: true,
        emptyStartSafe: true,
      },
      durationMs: 124.5,
      errors: [],
    };
    expect(restoreValidationResultSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects invalid numbers or missing fields', () => {
    const invalid = {
      valid: true,
      durationMs: -1,
    };
    expect(restoreValidationResultSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('restoreRecoveryStateSchema', () => {
  it('accepts valid recovery states', () => {
    const states = [
      { id: 'readiness', status: 'restoring', updatedAt: new Date().toISOString() },
      {
        id: 'readiness',
        status: 'validation_failed',
        error: 'Referential integrity check failed',
        updatedAt: new Date().toISOString(),
      },
      { id: 'readiness', status: 'ready', updatedAt: new Date().toISOString() },
    ];
    for (const state of states) {
      expect(restoreRecoveryStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it('rejects unknown statuses or invalid ids', () => {
    expect(
      restoreRecoveryStateSchema.safeParse({
        id: 'other',
        status: 'ready',
        updatedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);

    expect(
      restoreRecoveryStateSchema.safeParse({
        id: 'readiness',
        status: 'broken',
        updatedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
});
