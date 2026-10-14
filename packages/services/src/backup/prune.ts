import type { Dirent } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  type BackupManifest,
  type BackupPruneResult,
  backupManifestSchema,
  validationFailed,
} from '@orbit/shared';
import { verifyPreMutationChecksums } from './checksums.ts';

export interface BackupPruneOptions {
  readonly destinationDir: string;
  readonly keepCount?: number | undefined;
  readonly keepDays?: number | undefined;
  readonly keepHourly?: number | undefined;
  readonly keepDaily?: number | undefined;
  readonly keepWeekly?: number | undefined;
  readonly keepMonthly?: number | undefined;
  readonly maxTotalBytes?: number | undefined;
  readonly cleanIncomplete?: boolean | undefined;
  readonly incompleteMaxAgeHours?: number | undefined;
  readonly staleAlertHours?: number | undefined;
  readonly pinnedBackupIds?: readonly string[] | undefined;
  readonly dryRun?: boolean | undefined;
}

interface DiscoveredBackup {
  readonly id: string;
  readonly path: string;
  readonly manifest: BackupManifest;
  readonly createdAt: Date;
  readonly size: number;
  readonly isPinned: boolean;
}

export function parseByteSize(value: string | number): number {
  if (typeof value === 'number') {
    if (value < 0 || !Number.isFinite(value)) {
      throw validationFailed(`Invalid byte size: ${value}`);
    }
    return Math.floor(value);
  }

  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B?)$/i);
  if (!match) {
    throw validationFailed(`Cannot parse byte size: "${value}"`);
  }

  const rawNumber = Number.parseFloat(match[1] ?? '0');
  const unit = (match[2] ?? '').toUpperCase();

  const multipliers: Record<string, number> = {
    '': 1,
    B: 1,
    K: 1024,
    KB: 1024,
    M: 1024 * 1024,
    MB: 1024 * 1024,
    G: 1024 * 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    T: 1024 * 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  const multiplier = multipliers[unit] ?? 1;
  return Math.floor(rawNumber * multiplier);
}

async function calculateDirectorySize(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await calculateDirectorySize(fullPath);
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath).catch(() => null);
      if (fileStat !== null) {
        total += fileStat.size;
      }
    }
  }
  return total;
}

async function isPinnedBackup(
  backupDir: string,
  manifest: BackupManifest,
  pinnedIds: readonly string[] | undefined,
): Promise<boolean> {
  const dirId = basename(backupDir);
  if (pinnedIds?.includes(dirId)) {
    return true;
  }

  if (
    manifest.metadata['pinned'] === 'true' ||
    manifest.metadata['legalHold'] === 'true' ||
    manifest.metadata['pinned'] === '1'
  ) {
    return true;
  }

  const markerFiles = ['.pinned', '.hold', 'legal-hold.json'];
  for (const marker of markerFiles) {
    const markerStat = await stat(join(backupDir, marker)).catch(() => null);
    if (markerStat !== null) {
      return true;
    }
  }

  return false;
}

function getGfsSlotKey(date: Date, tier: 'hourly' | 'daily' | 'weekly' | 'monthly'): string {
  const iso = date.toISOString();
  if (tier === 'hourly') {
    return iso.slice(0, 13);
  }
  if (tier === 'daily') {
    return iso.slice(0, 10);
  }
  if (tier === 'monthly') {
    return iso.slice(0, 7);
  }

  const firstDayOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNumber}`;
}

function retainGfsSlots(
  backups: readonly DiscoveredBackup[],
  tier: 'hourly' | 'daily' | 'weekly' | 'monthly',
  keepSlots: number,
  retainedIds: Set<string>,
): void {
  if (keepSlots <= 0) return;

  const slots = new Map<string, DiscoveredBackup>();
  for (const backup of backups) {
    const key = getGfsSlotKey(backup.createdAt, tier);
    const existing = slots.get(key);
    if (existing === undefined || backup.createdAt.getTime() > existing.createdAt.getTime()) {
      slots.set(key, backup);
    }
  }

  const sortedSlots = [...slots.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  for (let i = 0; i < Math.min(keepSlots, sortedSlots.length); i += 1) {
    const item = sortedSlots[i];
    if (item !== undefined) {
      retainedIds.add(item.id);
    }
  }
}

async function shouldCleanCandidate(
  fullPath: string,
  name: string,
  maxAgeHours: number | undefined,
): Promise<boolean> {
  const itemStat = await stat(fullPath).catch(() => null);
  if (itemStat === null) {
    return false;
  }

  const lockStat = await stat(join(fullPath, '.backup.lock')).catch(() => null);
  if (lockStat !== null) {
    const lockAgeHours = (Date.now() - lockStat.mtime.getTime()) / (1000 * 60 * 60);
    if (lockAgeHours < 24) {
      return false;
    }
  }

  const ageHours = (Date.now() - itemStat.mtime.getTime()) / (1000 * 60 * 60);
  const thresholdHours = maxAgeHours ?? (name.endsWith('.tmp') ? 24 : 0);
  return ageHours >= thresholdHours;
}

async function cleanIncompleteDirectories(
  destinationDir: string,
  candidates: readonly string[],
  maxAgeHours: number | undefined,
  dryRun: boolean,
): Promise<{ deleted: string[]; failed: string[]; freedBytes: number }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  let freedBytes = 0;

  for (const name of candidates) {
    const fullPath = join(destinationDir, name);
    if (!(await shouldCleanCandidate(fullPath, name, maxAgeHours))) {
      continue;
    }

    const bytes = await calculateDirectorySize(fullPath);
    if (dryRun) {
      deleted.push(name);
      freedBytes += bytes;
    } else {
      try {
        await rm(fullPath, { recursive: true, force: true });
        deleted.push(name);
        freedBytes += bytes;
      } catch {
        failed.push(name);
      }
    }
  }

  return { deleted, failed, freedBytes };
}

async function tryDiscoverBackup(
  destinationDir: string,
  name: string,
  pinnedIds: readonly string[] | undefined,
): Promise<DiscoveredBackup | undefined> {
  const fullPath = join(destinationDir, name);
  const manifestPath = join(fullPath, 'manifest.json');

  try {
    const rawText = await readFile(manifestPath, 'utf8');
    const parsedManifest = backupManifestSchema.parse(JSON.parse(rawText));
    await verifyPreMutationChecksums(fullPath, parsedManifest);

    const size = await calculateDirectorySize(fullPath);
    const isPinned = await isPinnedBackup(fullPath, parsedManifest, pinnedIds);

    return {
      id: name,
      path: fullPath,
      manifest: parsedManifest,
      createdAt: new Date(parsedManifest.createdAt),
      size,
      isPinned,
    };
  } catch {
    return undefined;
  }
}

async function discoverBackups(
  destinationDir: string,
  candidateDirs: readonly string[],
  pinnedIds: readonly string[] | undefined,
): Promise<DiscoveredBackup[]> {
  const discovered: DiscoveredBackup[] = [];

  for (const name of candidateDirs) {
    const backup = await tryDiscoverBackup(destinationDir, name, pinnedIds);
    if (backup !== undefined) {
      discovered.push(backup);
    }
  }

  return discovered;
}

function applyTimeAndCountRules(
  discovered: readonly DiscoveredBackup[],
  options: BackupPruneOptions,
  toRetain: Set<string>,
): void {
  const now = Date.now();
  if (options.keepCount !== undefined && options.keepCount > 0) {
    for (let i = 0; i < Math.min(options.keepCount, discovered.length); i += 1) {
      const item = discovered[i];
      if (item !== undefined) {
        toRetain.add(item.id);
      }
    }
  }

  if (options.keepDays !== undefined) {
    const cutoff = now - options.keepDays * 86400 * 1000;
    for (const item of discovered) {
      if (item.createdAt.getTime() >= cutoff) {
        toRetain.add(item.id);
      }
    }
  }
}

function applyGfsRules(
  discovered: readonly DiscoveredBackup[],
  options: BackupPruneOptions,
  toRetain: Set<string>,
): void {
  if (options.keepHourly !== undefined) {
    retainGfsSlots(discovered, 'hourly', options.keepHourly, toRetain);
  }
  if (options.keepDaily !== undefined) {
    retainGfsSlots(discovered, 'daily', options.keepDaily, toRetain);
  }
  if (options.keepWeekly !== undefined) {
    retainGfsSlots(discovered, 'weekly', options.keepWeekly, toRetain);
  }
  if (options.keepMonthly !== undefined) {
    retainGfsSlots(discovered, 'monthly', options.keepMonthly, toRetain);
  }
}

function determineRetainedIds(
  discovered: readonly DiscoveredBackup[],
  options: BackupPruneOptions,
  newestGoodBackupId: string,
): Set<string> {
  const toRetain = new Set<string>();
  toRetain.add(newestGoodBackupId);

  for (const item of discovered) {
    if (item.isPinned) {
      toRetain.add(item.id);
    }
  }

  const hasSpecificRule =
    options.keepCount !== undefined ||
    options.keepDays !== undefined ||
    options.keepHourly !== undefined ||
    options.keepDaily !== undefined ||
    options.keepWeekly !== undefined ||
    options.keepMonthly !== undefined;

  if (hasSpecificRule) {
    applyTimeAndCountRules(discovered, options, toRetain);
    applyGfsRules(discovered, options, toRetain);
  } else {
    for (const item of discovered) {
      toRetain.add(item.id);
    }
  }

  return toRetain;
}

function applyQuotaLimit(
  discovered: readonly DiscoveredBackup[],
  toRetain: Set<string>,
  newestGoodBackupId: string,
  maxTotalBytes: number,
): void {
  let currentTotalBytes = discovered
    .filter((b) => toRetain.has(b.id))
    .reduce((acc, b) => acc + b.size, 0);

  if (currentTotalBytes <= maxTotalBytes) {
    return;
  }

  const quotaPruneCandidates = discovered
    .filter((b) => toRetain.has(b.id) && b.id !== newestGoodBackupId && !b.isPinned)
    .reverse();

  for (const item of quotaPruneCandidates) {
    if (currentTotalBytes <= maxTotalBytes) break;
    toRetain.delete(item.id);
    currentTotalBytes -= item.size;
  }
}

async function executePruning(
  discovered: readonly DiscoveredBackup[],
  toRetain: Set<string>,
  dryRun: boolean,
): Promise<{
  deletedBackups: string[];
  retainedBackups: string[];
  pinnedBackups: string[];
  failedDeletions: string[];
  freedBytes: number;
  totalRemainingBytes: number;
}> {
  const deletedBackups: string[] = [];
  const retainedBackups: string[] = [];
  const pinnedBackups: string[] = [];
  const failedDeletions: string[] = [];
  let freedBytes = 0;
  let totalRemainingBytes = 0;

  for (const item of discovered) {
    if (toRetain.has(item.id)) {
      retainedBackups.push(item.id);
      totalRemainingBytes += item.size;
      if (item.isPinned) {
        pinnedBackups.push(item.id);
      }
    } else if (dryRun) {
      deletedBackups.push(item.id);
      freedBytes += item.size;
    } else {
      try {
        await rm(item.path, { recursive: true, force: true });
        deletedBackups.push(item.id);
        freedBytes += item.size;
      } catch {
        failedDeletions.push(item.id);
        totalRemainingBytes += item.size;
      }
    }
  }

  return {
    deletedBackups,
    retainedBackups,
    pinnedBackups,
    failedDeletions,
    freedBytes,
    totalRemainingBytes,
  };
}

export async function pruneBackups(options: BackupPruneOptions): Promise<BackupPruneResult> {
  const destinationDir = resolve(options.destinationDir);
  const cleanIncomplete = options.cleanIncomplete ?? true;
  const dryRun = options.dryRun ?? false;

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(destinationDir, { withFileTypes: true });
  } catch (error) {
    throw validationFailed(
      `Backup destination directory does not exist or is not readable: ${destinationDir}`,
      { cause: error },
    );
  }

  const incompleteCandidates: string[] = [];
  const candidateDirs: string[] = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'lost+found' || entry.name.startsWith('.')) continue;
    if (
      entry.name.startsWith('orbit-backup-') &&
      (entry.name.endsWith('.incomplete') || entry.name.endsWith('.tmp'))
    ) {
      incompleteCandidates.push(entry.name);
    } else {
      candidateDirs.push(entry.name);
    }
  }

  let totalFreedBytes = 0;
  const deletedIncomplete: string[] = [];
  const allFailedDeletions: string[] = [];

  if (cleanIncomplete) {
    const incResult = await cleanIncompleteDirectories(
      destinationDir,
      incompleteCandidates,
      options.incompleteMaxAgeHours,
      dryRun,
    );
    deletedIncomplete.push(...incResult.deleted);
    allFailedDeletions.push(...incResult.failed);
    totalFreedBytes += incResult.freedBytes;
  }

  const discovered = await discoverBackups(destinationDir, candidateDirs, options.pinnedBackupIds);

  if (discovered.length === 0) {
    return {
      evaluatedCount: 0,
      deletedBackups: [],
      retainedBackups: [],
      pinnedBackups: [],
      deletedIncomplete,
      failedDeletions: allFailedDeletions,
      freedBytes: totalFreedBytes,
      totalRemainingBytes: 0,
      newestGoodBackupId: undefined,
      isStale: false,
      staleAgeHours: undefined,
      dryRun,
    };
  }

  discovered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const newestGoodBackup = discovered[0] as DiscoveredBackup;
  const newestAgeHours = (Date.now() - newestGoodBackup.createdAt.getTime()) / (1000 * 60 * 60);
  const isStale = options.staleAlertHours !== undefined && newestAgeHours > options.staleAlertHours;
  const staleAgeHours = Math.round(newestAgeHours * 10) / 10;

  const toRetain = determineRetainedIds(discovered, options, newestGoodBackup.id);

  if (options.maxTotalBytes !== undefined) {
    applyQuotaLimit(discovered, toRetain, newestGoodBackup.id, options.maxTotalBytes);
  }

  const execution = await executePruning(discovered, toRetain, dryRun);
  totalFreedBytes += execution.freedBytes;
  allFailedDeletions.push(...execution.failedDeletions);

  return {
    evaluatedCount: discovered.length,
    deletedBackups: execution.deletedBackups,
    retainedBackups: execution.retainedBackups,
    pinnedBackups: execution.pinnedBackups,
    deletedIncomplete,
    failedDeletions: allFailedDeletions,
    freedBytes: totalFreedBytes,
    totalRemainingBytes: execution.totalRemainingBytes,
    newestGoodBackupId: newestGoodBackup.id,
    isStale,
    staleAgeHours,
    dryRun,
  };
}
