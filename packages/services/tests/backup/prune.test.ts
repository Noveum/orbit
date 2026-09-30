import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
          sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          bytes: options?.sizeBytes ?? 1024,
        },
        objects: [],
      },
      counts: { workspaces: 1, users: 1, attachments: 0, issues: 0 },
      encryption: { enabled: false },
      metadata: options?.pinned ? { pinned: 'true' } : {},
    };

    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(backupDir, 'database.dump'), Buffer.alloc(options?.sizeBytes ?? 1024));

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
});
