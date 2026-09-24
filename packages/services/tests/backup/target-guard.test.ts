import { describe, expect, it } from 'bun:test';
import { assertRestoreTargetConfirmed } from '../../src/backup/target-guard.ts';

describe('assertRestoreTargetConfirmed', () => {
  it('accepts matching target confirmation without bucket', () => {
    const dbUrl = 'postgres://admin:secretPass123@db.prod.internal:5432/orbit_prod';
    const expectedIdentity = 'db.prod.internal:5432/db/orbit_prod';

    const result = assertRestoreTargetConfirmed(dbUrl, undefined, expectedIdentity);
    expect(result.identity).toBe(expectedIdentity);
    expect(result.identity).not.toContain('secretPass123');
    expect(result.identity).not.toContain('admin');
  });

  it('accepts matching target confirmation with bucket', () => {
    const dbUrl = 'postgres://user:pass@127.0.0.1:5434/orbit_staging';
    const bucket = 'orbit-staging-attachments';
    const expectedIdentity = '127.0.0.1:5434/db/orbit_staging#bucket:orbit-staging-attachments';

    const result = assertRestoreTargetConfirmed(dbUrl, bucket, expectedIdentity);
    expect(result.identity).toBe(expectedIdentity);
    expect(result.bucket).toBe(bucket);
  });

  it('throws validation error when confirmation is missing', () => {
    const dbUrl = 'postgres://user:pass@localhost:5432/orbit';
    expect(() => assertRestoreTargetConfirmed(dbUrl, undefined, undefined)).toThrow(
      /Refusing to restore into target "localhost:5432\/db\/orbit"/,
    );
    expect(() => assertRestoreTargetConfirmed(dbUrl, undefined, '')).toThrow(
      /Refusing to restore into target "localhost:5432\/db\/orbit"/,
    );
  });

  it('throws validation error when confirmation does not match target', () => {
    const dbUrl = 'postgres://user:pass@db.prod.internal:5432/orbit_prod';
    expect(() =>
      assertRestoreTargetConfirmed(dbUrl, undefined, 'db.test.internal:5432/orbit_test'),
    ).toThrow(/Destructive restore confirmation/);
  });

  it('throws validation error when database url is empty', () => {
    expect(() => assertRestoreTargetConfirmed('', undefined, 'target')).toThrow(
      /Target database connection URL is required/,
    );
  });
});
