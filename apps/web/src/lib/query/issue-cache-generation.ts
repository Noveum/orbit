import type { QueryClient, QueryKey } from '@tanstack/react-query';

const deletionGenerations = new WeakMap<QueryClient, Map<string, number>>();
const revisionGenerations = new WeakMap<QueryClient, Map<string, number>>();
const listRevisionGenerations = new WeakMap<QueryClient, Map<string, number>>();
const cacheRevisionGenerations = new WeakMap<QueryClient, number>();

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
