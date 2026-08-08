import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core';
import type { Query } from '@tanstack/react-query';
import { createStore, del, get, set } from 'idb-keyval';
import { z } from 'zod';
import { BOOTSTRAP_ROOT, ISSUE_ROOT, ISSUES_ROOT } from './keys.ts';
import { bootstrapSchema, issueDetailSchema, issueListSchema } from './schemas.ts';

const DATABASE_NAME = 'orbit-query-cache';
const STORE_NAME = 'cache';
const STORAGE_KEY = 'workspace';

export const CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

const CACHE_SHAPE_VERSION = 1;

function infinitePages<Schema extends z.ZodType>(page: Schema) {
  return z.object({ pages: z.array(page), pageParams: z.array(z.unknown()) });
}

const PERSISTED_ROOTS: Readonly<Record<string, z.ZodType>> = {
  [BOOTSTRAP_ROOT]: bootstrapSchema,
  [ISSUES_ROOT]: infinitePages(issueListSchema),
  [ISSUE_ROOT]: issueDetailSchema,
};

function schemaForKey(queryKey: readonly unknown[]): z.ZodType | undefined {
  const root = queryKey[0];
  return typeof root === 'string' ? PERSISTED_ROOTS[root] : undefined;
}

export function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false;
  return schemaForKey(query.queryKey) !== undefined;
}

const persistedQuerySchema = z.object({
  queryKey: z.array(z.unknown()),
  queryHash: z.string(),
  state: z.object({ data: z.unknown() }).loose(),
});

const persistedClientSchema = z.object({
  buster: z.string(),
  timestamp: z.number(),
  clientState: z.object({
    mutations: z.array(z.unknown()),
    queries: z.array(persistedQuerySchema),
  }),
});

function emptyClient(): PersistedClient {
  return { buster: '', timestamp: 0, clientState: { mutations: [], queries: [] } };
}

export function restorable(raw: unknown): PersistedClient {
  if (!persistedClientSchema.safeParse(raw).success) return emptyClient();

  const client = raw as PersistedClient;
  const queries = client.clientState.queries.filter((query) => {
    const schema = schemaForKey(query.queryKey);
    return schema?.safeParse(query.state.data).success === true;
  });

  return { ...client, clientState: { ...client.clientState, queries } };
}

export function cacheBuster(userId: string, organizationId: string): string {
  return `${CACHE_SHAPE_VERSION}:${userId}:${organizationId}`;
}

let store: ReturnType<typeof createStore> | undefined;

function cacheStore() {
  store ??= createStore(DATABASE_NAME, STORE_NAME);
  return store;
}

export function createCachePersister(): Persister {
  const target = cacheStore();
  return createAsyncStoragePersister({
    key: STORAGE_KEY,
    throttleTime: 1_000,
    deserialize: (cached) => restorable(JSON.parse(cached) as unknown),
    storage: {
      getItem: async (key) => (await get<string>(key, target)) ?? null,
      setItem: async (key, value) => {
        await set(key, value, target);
      },
      removeItem: async (key) => {
        await del(key, target);
      },
    },
  });
}

export async function forgetPersistedCache(): Promise<void> {
  await del(STORAGE_KEY, cacheStore()).catch(() => undefined);
}
