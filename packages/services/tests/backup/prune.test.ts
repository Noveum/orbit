import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseByteSize, pruneBackups } from '../../src/backup/prune.ts';

describe('backup retention and pruning', () => {
  it('parses byte sizes with various units and numbers', () => {
    expect(parseByteSize(1024)).toBe(1024);
    expect(parseByteSize('500B')).toBe(500);
    expect(parseByteSize('10KB')).toBe(10 * 1024);
    expect(parseByteSize('5MB')).toBe(5 * 1024 * 1024);
    expect(parseByteSize('2GB')).toBe(2 * 1024 * 1024 * 1024);
    expect(parseByteSize('1TB')).toBe(1024 * 1024 * 1024 * 1024);
    expect(() => parseByteSize('invalid')).toThrow();
  });

  async function createMockBackup(
    rootDir: string,
    id: string,
    createdAt: string,
    options?: { pinned?: boolean; holdFile?: boolean; sizeBytes?: number },
  ): Promise<string> {
    const backupDir = join(rootDir, id);
    await mkdir(backupDir, { recursive: true });

    const dumpBuffer = Buffer.alloc(options?.sizeBytes ?? 1024);
    const dumpSha256 = createHash('sha256').update(dumpBuffer).digest('hex');

    const manifest = {
      formatVersion: '1.0.0',
      orbitVersion: '0.1.0',
      sourceRevision: 'abc1234',
      databaseVersion: 'PostgreSQL 18.0',
      createdAt,
      migrationLedger: [],
      configuration: {},
      checksums: {
        databaseDump: {
          file: 'database.dump',
          sha256: dumpSha256,
          bytes: options?.sizeBytes ?? 1024,
        },
        objects: [],
      },
      counts: { workspaces: 1, users: 1, attachments: 0, issues: 0 },
      encryption: { enabled: false },
      metadata: options?.pinned ? { pinned: 'true' } : {},
    };

    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(backupDir, 'database.dump'), dumpBuffer);

    if (options?.holdFile) {
      await writeFile(join(backupDir, '.pinned'), 'pinned by test');
    }

    return backupDir;
  }

  it('evaluates an empty destination directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-empty-'));
    try {
      const result = await pruneBackups({ destinationDir: tempDir });
      expect(result.evaluatedCount).toBe(0);
      expect(result.deletedBackups.length).toBe(0);
      expect(result.retainedBackups.length).toBe(0);
      expect(result.newestGoodBackupId).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('cleans up incomplete and temporary backup directories', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-inc-'));
    try {
      const incDir = join(tempDir, 'orbit-backup-2026-09-01T12-00-00Z.incomplete');
      const tmpDirEntry = join(tempDir, 'orbit-backup-2026-09-02T12-00-00Z.tmp');
      await mkdir(incDir, { recursive: true });
      await mkdir(tmpDirEntry, { recursive: true });
      await writeFile(join(incDir, 'database.dump'), Buffer.alloc(5000));
      await writeFile(join(tmpDirEntry, 'partial'), Buffer.alloc(2000));

      const goodDate = new Date().toISOString();
      await createMockBackup(tempDir, 'orbit-backup-good', goodDate);

      const result = await pruneBackups({
        destinationDir: tempDir,
        cleanIncomplete: true,
        incompleteMaxAgeHours: 0,
      });

      expect(result.deletedIncomplete.length).toBe(2);
      expect(result.deletedIncomplete).toContain('orbit-backup-2026-09-01T12-00-00Z.incomplete');
      expect(result.deletedIncomplete).toContain('orbit-backup-2026-09-02T12-00-00Z.tmp');
      expect(result.retainedBackups).toContain('orbit-backup-good');
      expect(result.freedBytes).toBeGreaterThanOrEqual(7000);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves recent temporary directories by default unless age threshold is reached', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-tmp-safe-'));
    try {
      const freshTmpDir = join(tempDir, 'orbit-backup-2026-09-02T12-00-00Z.tmp');
      await mkdir(freshTmpDir, { recursive: true });
      await writeFile(join(freshTmpDir, 'partial'), Buffer.alloc(1000));

      const goodDate = new Date().toISOString();
      await createMockBackup(tempDir, 'orbit-backup-good', goodDate);

      const result = await pruneBackups({
        destinationDir: tempDir,
        cleanIncomplete: true,
      });

      expect(result.deletedIncomplete).not.toContain('orbit-backup-2026-09-02T12-00-00Z.tmp');
      expect(await stat(freshTmpDir)).not.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves candidate directories with unparseable manifests instead of deleting them', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-unparseable-'));
    try {
      const corruptDir = join(tempDir, 'orbit-backup-corrupted');
      await mkdir(corruptDir, { recursive: true });
      await writeFile(join(corruptDir, 'manifest.json'), '{ invalid json');

      const goodDate = new Date().toISOString();
      await createMockBackup(tempDir, 'orbit-backup-good', goodDate);

      const result = await pruneBackups({
        destinationDir: tempDir,
        cleanIncomplete: true,
      });

      expect(result.deletedBackups).not.toContain('orbit-backup-corrupted');
      expect(result.deletedIncomplete).not.toContain('orbit-backup-corrupted');
      expect(await stat(corruptDir)).not.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('retains specified count of newest backups and removes older ones', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-count-'));
    try {
      await createMockBackup(tempDir, 'backup-1', '2026-09-01T10:00:00.000Z');
      await createMockBackup(tempDir, 'backup-2', '2026-09-02T10:00:00.000Z');
      await createMockBackup(tempDir, 'backup-3', '2026-09-03T10:00:00.000Z');
      await createMockBackup(tempDir, 'backup-4', '2026-09-04T10:00:00.000Z');

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 2,
      });

      expect(result.evaluatedCount).toBe(4);
      expect(result.retainedBackups).toEqual(['backup-4', 'backup-3']);
      expect(result.deletedBackups).toEqual(['backup-2', 'backup-1']);
      expect(result.newestGoodBackupId).toBe('backup-4');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('guarantees protection of the newest known-good backup even with keep-count 0', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-guard-'));
    try {
      await createMockBackup(tempDir, 'backup-old', '2026-09-01T10:00:00.000Z');
      await createMockBackup(tempDir, 'backup-newest', '2026-09-10T10:00:00.000Z');

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 0,
      });

      expect(result.retainedBackups).toEqual(['backup-newest']);
      expect(result.deletedBackups).toEqual(['backup-old']);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves pinned backups under legal hold regardless of age or count rules', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-pinned-'));
    try {
      await createMockBackup(tempDir, 'backup-pinned-file', '2026-08-01T10:00:00.000Z', {
        holdFile: true,
      });
      await createMockBackup(tempDir, 'backup-pinned-meta', '2026-08-05T10:00:00.000Z', {
        pinned: true,
      });
      await createMockBackup(tempDir, 'backup-old-unpinned', '2026-08-10T10:00:00.000Z');
      await createMockBackup(tempDir, 'backup-newest', '2026-09-20T10:00:00.000Z');

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
      });

      expect(result.pinnedBackups).toContain('backup-pinned-file');
      expect(result.pinnedBackups).toContain('backup-pinned-meta');
      expect(result.retainedBackups).toContain('backup-newest');
      expect(result.retainedBackups).toContain('backup-pinned-file');
      expect(result.retainedBackups).toContain('backup-pinned-meta');
      expect(result.deletedBackups).toEqual(['backup-old-unpinned']);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('enforces destination quota by removing oldest unpinned backups while keeping newest', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-quota-'));
    try {
      await createMockBackup(tempDir, 'backup-1', '2026-09-01T10:00:00.000Z', {
        sizeBytes: 10000,
      });
      await createMockBackup(tempDir, 'backup-2', '2026-09-02T10:00:00.000Z', {
        sizeBytes: 10000,
      });
      await createMockBackup(tempDir, 'backup-3', '2026-09-03T10:00:00.000Z', {
        sizeBytes: 10000,
      });

      const result = await pruneBackups({
        destinationDir: tempDir,
        maxTotalBytes: 15000,
      });

      expect(result.retainedBackups).toEqual(['backup-3']);
      expect(result.deletedBackups).toContain('backup-1');
      expect(result.deletedBackups).toContain('backup-2');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('retains all backups when quota is the only option and size does not exceed quota', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-quota-under-'));
    try {
      await createMockBackup(tempDir, 'backup-1', '2026-09-01T10:00:00.000Z', {
        sizeBytes: 10000,
      });
      await createMockBackup(tempDir, 'backup-2', '2026-09-02T10:00:00.000Z', {
        sizeBytes: 10000,
      });
      await createMockBackup(tempDir, 'backup-3', '2026-09-03T10:00:00.000Z', {
        sizeBytes: 10000,
      });

      const result = await pruneBackups({
        destinationDir: tempDir,
        maxTotalBytes: 50000,
      });

      expect(result.retainedBackups.sort()).toEqual(['backup-1', 'backup-2', 'backup-3'].sort());
      expect(result.deletedBackups).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('performs dry run without deleting directories from disk', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-dry-'));
    try {
      const b1 = await createMockBackup(tempDir, 'backup-1', '2026-09-01T10:00:00.000Z');
      await createMockBackup(tempDir, 'backup-2', '2026-09-02T10:00:00.000Z');

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.deletedBackups).toEqual(['backup-1']);
      expect(result.retainedBackups).toEqual(['backup-2']);

      const { stat } = await import('node:fs/promises');
      const b1Stat = await stat(b1).catch(() => null);
      expect(b1Stat).not.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('alerts when newest backup is stale', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-stale-'));
    try {
      const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      await createMockBackup(tempDir, 'backup-stale', oldDate);

      const result = await pruneBackups({
        destinationDir: tempDir,
        staleAlertHours: 24,
      });

      expect(result.isStale).toBe(true);
      expect(result.staleAgeHours).toBeGreaterThanOrEqual(47);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('pins backups by directory name and prevents their deletion', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-dir-pinned-'));
    try {
      await createMockBackup(
        tempDir,
        'orbit-backup-2026-08-01T10-00-00-000Z-aaaaaaaa',
        '2026-08-01T10:00:00.000Z',
      );
      await createMockBackup(
        tempDir,
        'orbit-backup-2026-09-01T10-00-00-000Z-bbbbbbbb',
        '2026-09-01T10:00:00.000Z',
      );

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
        pinnedBackupIds: ['orbit-backup-2026-08-01T10-00-00-000Z-aaaaaaaa'],
      });

      expect(result.pinnedBackups).toEqual(['orbit-backup-2026-08-01T10-00-00-000Z-aaaaaaaa']);
      expect(result.retainedBackups).toContain('orbit-backup-2026-08-01T10-00-00-000Z-aaaaaaaa');
      expect(result.retainedBackups).toContain('orbit-backup-2026-09-01T10-00-00-000Z-bbbbbbbb');
      expect(result.deletedBackups).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('guarantees newest backup survives quota limit even when it exceeds maxTotalBytes alone', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-quota-newest-'));
    try {
      await createMockBackup(tempDir, 'backup-old', '2026-09-01T10:00:00.000Z', {
        sizeBytes: 10000,
      });
      await createMockBackup(tempDir, 'backup-newest', '2026-09-10T10:00:00.000Z', {
        sizeBytes: 10000,
      });

      const result = await pruneBackups({
        destinationDir: tempDir,
        maxTotalBytes: 5000,
      });

      expect(result.retainedBackups).toEqual(['backup-newest']);
      expect(result.deletedBackups).toEqual(['backup-old']);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves pinned backups under quota pruning even when quota is exceeded', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-quota-pinned-'));
    try {
      await createMockBackup(tempDir, 'backup-pinned', '2026-09-01T10:00:00.000Z', {
        pinned: true,
        sizeBytes: 10000,
      });
      await createMockBackup(tempDir, 'backup-unpinned-old', '2026-09-02T10:00:00.000Z', {
        sizeBytes: 10000,
      });
      await createMockBackup(tempDir, 'backup-newest', '2026-09-03T10:00:00.000Z', {
        sizeBytes: 10000,
      });

      const result = await pruneBackups({
        destinationDir: tempDir,
        maxTotalBytes: 15000,
      });

      expect(result.retainedBackups).toContain('backup-pinned');
      expect(result.retainedBackups).toContain('backup-newest');
      expect(result.deletedBackups).toEqual(['backup-unpinned-old']);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not delete active temporary directory holding .backup.lock even with maxAgeHours 0', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-lock-'));
    try {
      const activeTmp = join(tempDir, 'orbit-backup-running.tmp');
      await mkdir(activeTmp, { recursive: true });
      await writeFile(
        join(activeTmp, '.backup.lock'),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
      );
      await writeFile(join(activeTmp, 'database.dump'), Buffer.alloc(10000));

      const oldTmp = join(tempDir, 'orbit-backup-old.tmp');
      await mkdir(oldTmp, { recursive: true });
      await writeFile(join(oldTmp, 'abandoned'), Buffer.alloc(5000));

      const result = await pruneBackups({
        destinationDir: tempDir,
        cleanIncomplete: true,
        incompleteMaxAgeHours: 0,
      });

      expect(result.deletedIncomplete).toContain('orbit-backup-old.tmp');
      expect(result.deletedIncomplete).not.toContain('orbit-backup-running.tmp');
      const activeStat = await stat(activeTmp).catch(() => null);
      expect(activeStat).not.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not treat a backup with missing or mismatched dump as newest good backup', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-corrupt-'));
    try {
      await createMockBackup(tempDir, 'backup-healthy-old', '2026-09-01T10:00:00.000Z', {
        sizeBytes: 1000,
      });

      const corruptDir = join(tempDir, 'backup-corrupt-newest');
      await mkdir(corruptDir, { recursive: true });
      const manifest = {
        formatVersion: '1.0.0',
        orbitVersion: '0.1.0',
        sourceRevision: 'abc1234',
        databaseVersion: 'PostgreSQL 18.0',
        createdAt: '2026-09-10T10:00:00.000Z',
        migrationLedger: [],
        configuration: {},
        checksums: {
          databaseDump: {
            file: 'database.dump',
            sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            bytes: 5000,
          },
          objects: [],
        },
        counts: { workspaces: 1, users: 1, attachments: 0, issues: 0 },
        encryption: { enabled: false },
        metadata: {},
      };
      await writeFile(join(corruptDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
      await writeFile(join(corruptDir, 'database.dump'), Buffer.alloc(100));

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
      });

      expect(result.newestGoodBackupId).toBe('backup-healthy-old');
      expect(result.retainedBackups).toEqual(['backup-healthy-old']);
      expect(result.deletedBackups).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not treat a backup with same-length corrupted dump as good backup', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-corrupt-same-length-'));
    try {
      const goodDate = '2026-09-01T10:00:00.000Z';
      await createMockBackup(tempDir, 'backup-healthy-old', goodDate);

      const corruptDir = join(tempDir, 'backup-corrupt-same-length');
      await mkdir(corruptDir, { recursive: true });
      const validBuffer = Buffer.alloc(1024, 0x01);
      const validSha256 = createHash('sha256').update(validBuffer).digest('hex');
      const manifest = {
        formatVersion: '1.0.0',
        orbitVersion: '0.1.0',
        sourceRevision: 'abc1234',
        databaseVersion: 'PostgreSQL 18.0',
        createdAt: '2026-09-10T10:00:00.000Z',
        migrationLedger: [],
        configuration: {},
        checksums: {
          databaseDump: {
            file: 'database.dump',
            sha256: validSha256,
            bytes: 1024,
          },
          objects: [],
        },
        counts: { workspaces: 1, users: 1, attachments: 0, issues: 0 },
        encryption: { enabled: false },
        metadata: {},
      };
      await writeFile(join(corruptDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
      const corruptedSameLength = Buffer.alloc(1024, 0x02);
      await writeFile(join(corruptDir, 'database.dump'), corruptedSameLength);

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
      });

      expect(result.newestGoodBackupId).toBe('backup-healthy-old');
      expect(result.retainedBackups).toEqual(['backup-healthy-old']);
      expect(result.deletedBackups).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts backups where manifest checksums use uppercase hexadecimal digits', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-upper-case-'));
    try {
      const backupDir = join(tempDir, 'backup-upper-case');
      await mkdir(backupDir, { recursive: true });
      const dumpBuffer = Buffer.alloc(1024, 0x05);
      const dumpSha256 = createHash('sha256').update(dumpBuffer).digest('hex').toUpperCase();

      const manifest = {
        formatVersion: '1.0.0',
        orbitVersion: '0.1.0',
        sourceRevision: 'abc1234',
        databaseVersion: 'PostgreSQL 18.0',
        createdAt: '2026-09-15T10:00:00.000Z',
        migrationLedger: [],
        configuration: {},
        checksums: {
          databaseDump: {
            file: 'database.dump',
            sha256: dumpSha256,
            bytes: 1024,
          },
          objects: [],
        },
        counts: { workspaces: 1, users: 1, attachments: 0, issues: 0 },
        encryption: { enabled: false },
        metadata: {},
      };
      await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
      await writeFile(join(backupDir, 'database.dump'), dumpBuffer);

      const result = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
      });

      expect(result.newestGoodBackupId).toBe('backup-upper-case');
      expect(result.retainedBackups).toEqual(['backup-upper-case']);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects backups where any referenced object is missing or corrupted', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-prune-objects-'));
    try {
      const goodDate = '2026-09-01T10:00:00.000Z';
      await createMockBackup(tempDir, 'backup-healthy-old', goodDate);

      const backupMissingObj = join(tempDir, 'backup-missing-obj');
      await mkdir(join(backupMissingObj, 'objects'), { recursive: true });
      const dumpBuffer = Buffer.alloc(1024, 0x06);
      const dumpSha256 = createHash('sha256').update(dumpBuffer).digest('hex');
      const objBuffer = Buffer.from('hello attachment', 'utf8');
      const objSha256 = createHash('sha256').update(objBuffer).digest('hex');

      const manifestMissing = {
        formatVersion: '1.0.0',
        orbitVersion: '0.1.0',
        sourceRevision: 'abc1234',
        databaseVersion: 'PostgreSQL 18.0',
        createdAt: '2026-09-20T10:00:00.000Z',
        migrationLedger: [],
        configuration: {},
        checksums: {
          databaseDump: {
            file: 'database.dump',
            sha256: dumpSha256,
            bytes: 1024,
          },
          objects: [
            {
              key: 'att/file1.png',
              sha256: objSha256,
              bytes: objBuffer.byteLength,
              contentType: 'image/png',
            },
          ],
        },
        counts: { workspaces: 1, users: 1, attachments: 1, issues: 0 },
        encryption: { enabled: false },
        metadata: {},
      };
      await writeFile(
        join(backupMissingObj, 'manifest.json'),
        JSON.stringify(manifestMissing),
        'utf8',
      );
      await writeFile(join(backupMissingObj, 'database.dump'), dumpBuffer);

      const resultMissing = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
      });
      expect(resultMissing.newestGoodBackupId).toBe('backup-healthy-old');

      await mkdir(join(backupMissingObj, 'objects', 'att'), { recursive: true });
      await writeFile(
        join(backupMissingObj, 'objects', 'att', 'file1.png'),
        Buffer.from('corrupted payload', 'utf8'),
      );

      const resultCorrupt = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
      });
      expect(resultCorrupt.newestGoodBackupId).toBe('backup-healthy-old');

      await writeFile(join(backupMissingObj, 'objects', 'att', 'file1.png'), objBuffer);
      const resultFixed = await pruneBackups({
        destinationDir: tempDir,
        keepCount: 1,
      });
      expect(resultFixed.newestGoodBackupId).toBe('backup-missing-obj');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
