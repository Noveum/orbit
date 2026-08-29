import type { QueryClient, QueryKey } from '@tanstack/react-query';

const deletionGenerations = new WeakMap<QueryClient, Map<string, number>>();
const revisionGenerations = new WeakMap<QueryClient, Map<string, number>>();
const listRevisionGenerations = new WeakMap<QueryClient, Map<string, number>>();
const cacheRevisionGenerations = new WeakMap<QueryClient, number>();
const cacheResetGenerations = new WeakMap<QueryClient, number>();
const syncWatermarks = new WeakMap<QueryClient, Map<string, number>>();
const survivalSyncWatermarks = new WeakMap<QueryClient, Map<string, number>>();

function incrementGenerations(
  generationsByClient: WeakMap<QueryClient, Map<string, number>>,
  client: QueryClient,
  issueIds: readonly string[],
): void {
  let generations = generationsByClient.get(client);
  if (generations === undefined) {
    generations = new Map();
    generationsByClient.set(client, generations);
  }
  for (const issueId of issueIds) {
    generations.set(issueId, (generations.get(issueId) ?? 0) + 1);
  }
}

export function issueDeletionGeneration(client: QueryClient, issueId: string): number {
  return deletionGenerations.get(client)?.get(issueId) ?? 0;
}

export function issueRevisionGeneration(client: QueryClient, issueId: string): number {
  return revisionGenerations.get(client)?.get(issueId) ?? 0;
}

export function issueCacheRevisionGeneration(client: QueryClient): number {
  return cacheRevisionGenerations.get(client) ?? 0;
}

export function issueCacheResetGeneration(client: QueryClient): number {
  return cacheResetGenerations.get(client) ?? 0;
}

export function issueSyncWatermark(client: QueryClient, issueId: string): number {
  return syncWatermarks.get(client)?.get(issueId) ?? Number.NEGATIVE_INFINITY;
}

export function issueSurvivalSyncWatermark(client: QueryClient, issueId: string): number {
  return survivalSyncWatermarks.get(client)?.get(issueId) ?? Number.NEGATIVE_INFINITY;
}

function issueListRevisionKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

export function issueListRevisionGeneration(client: QueryClient, queryKey: QueryKey): number {
  return listRevisionGenerations.get(client)?.get(issueListRevisionKey(queryKey)) ?? 0;
}

export function recordIssueListRevisions(
  client: QueryClient,
  queryKeys: readonly QueryKey[],
): void {
  if (queryKeys.length === 0) return;
  let generations = listRevisionGenerations.get(client);
  if (generations === undefined) {
    generations = new Map();
    listRevisionGenerations.set(client, generations);
  }
  for (const queryKey of queryKeys) {
    const key = issueListRevisionKey(queryKey);
    generations.set(key, (generations.get(key) ?? 0) + 1);
  }
}

export function recordIssueRevisions(client: QueryClient, issueIds: readonly string[]): void {
  if (issueIds.length === 0) return;
  incrementGenerations(revisionGenerations, client, issueIds);
  cacheRevisionGenerations.set(client, issueCacheRevisionGeneration(client) + 1);
}

export function recordIssueDeletions(client: QueryClient, issueIds: readonly string[]): void {
  incrementGenerations(deletionGenerations, client, issueIds);
  recordIssueRevisions(client, issueIds);
}

export function recordIssueSyncWatermark(
  client: QueryClient,
  issueId: string,
  syncId: number,
): void {
  let watermarks = syncWatermarks.get(client);
  if (watermarks === undefined) {
    watermarks = new Map();
    syncWatermarks.set(client, watermarks);
  }
  watermarks.set(issueId, Math.max(watermarks.get(issueId) ?? Number.NEGATIVE_INFINITY, syncId));
}

export function recordIssueSurvivalSyncWatermark(
  client: QueryClient,
  issueId: string,
  syncId: number,
): void {
  let watermarks = survivalSyncWatermarks.get(client);
  if (watermarks === undefined) {
    watermarks = new Map();
    survivalSyncWatermarks.set(client, watermarks);
  }
  watermarks.set(issueId, Math.max(watermarks.get(issueId) ?? Number.NEGATIVE_INFINITY, syncId));
}

export function recordIssueCacheReset(client: QueryClient): void {
  cacheRevisionGenerations.set(client, issueCacheRevisionGeneration(client) + 1);
  cacheResetGenerations.set(client, issueCacheResetGeneration(client) + 1);
}
