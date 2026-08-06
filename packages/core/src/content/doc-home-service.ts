import { and, asc, db, desc, eq, inArray, isNull, schema, sql } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { docFavoriteSchema, docHomeSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { type DocRow, docReadFilter, loadReadableDoc } from './doc-service.ts';

export const DOC_ENTITY = 'doc';

export interface DocHomeEntry {
  readonly id: string;
  readonly title: string;
  readonly collectionId: string | null;
  readonly projectId: string | null;
  readonly authorId: string;
  readonly updatedAt: Date;
}

export interface DocHome {
  readonly recent: DocHomeEntry[];
  readonly favorites: DocHomeEntry[];
  readonly updated: DocHomeEntry[];
}

const HOME_COLUMNS = {
  id: schema.doc.id,
  title: schema.doc.title,
  collectionId: schema.doc.collectionId,
  projectId: schema.doc.projectId,
  authorId: schema.doc.authorId,
  updatedAt: schema.doc.updatedAt,
};

function liveDocFilter(principal: Principal) {
  return and(
    eq(schema.doc.organizationId, principal.organizationId),
    isNull(schema.doc.archivedAt),
    docReadFilter(principal),
  );
}

export async function recordDocVisit(principal: Principal, docId: string): Promise<DocRow> {
  assertCan(principal, 'doc:read');
  const doc = await loadReadableDoc(db, principal, docId);

  await db
    .insert(schema.recentVisit)
    .values({
      id: newId(),
      organizationId: principal.organizationId,
      userId: principal.userId,
      entityType: DOC_ENTITY,
      entityId: doc.id,
      visitedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.recentVisit.userId,
        schema.recentVisit.organizationId,
        schema.recentVisit.entityType,
        schema.recentVisit.entityId,
      ],
      set: { visitedAt: new Date() },
    });

  return doc;
}

export async function listRecentDocs(principal: Principal, limit: number): Promise<DocHomeEntry[]> {
  return await db
    .select(HOME_COLUMNS)
    .from(schema.recentVisit)
    .innerJoin(schema.doc, eq(schema.doc.id, schema.recentVisit.entityId))
    .where(
      and(
        eq(schema.recentVisit.userId, principal.userId),
        eq(schema.recentVisit.organizationId, principal.organizationId),
        eq(schema.recentVisit.entityType, DOC_ENTITY),
        liveDocFilter(principal),
      ),
    )
    .orderBy(desc(schema.recentVisit.visitedAt))
    .limit(limit);
}

export async function listFavoriteDocs(
  principal: Principal,
  limit: number,
): Promise<DocHomeEntry[]> {
  return await db
    .select(HOME_COLUMNS)
    .from(schema.favorite)
    .innerJoin(schema.doc, eq(schema.doc.id, schema.favorite.entityId))
    .where(
      and(
        eq(schema.favorite.userId, principal.userId),
        eq(schema.favorite.organizationId, principal.organizationId),
        eq(schema.favorite.entityType, DOC_ENTITY),
        liveDocFilter(principal),
      ),
    )
    .orderBy(asc(schema.favorite.sortOrder), desc(schema.doc.updatedAt))
    .limit(limit);
}

async function listUpdatedDocs(principal: Principal, limit: number): Promise<DocHomeEntry[]> {
  return await db
    .select(HOME_COLUMNS)
    .from(schema.doc)
    .where(liveDocFilter(principal))
    .orderBy(desc(schema.doc.updatedAt))
    .limit(limit);
}

export async function favoriteDocIds(
  executor: Executor,
  principal: Principal,
  docIds: readonly string[],
): Promise<string[]> {
  if (docIds.length === 0) return [];
  const rows = await executor
    .select({ entityId: schema.favorite.entityId })
    .from(schema.favorite)
    .where(
      and(
        eq(schema.favorite.userId, principal.userId),
        eq(schema.favorite.organizationId, principal.organizationId),
        eq(schema.favorite.entityType, DOC_ENTITY),
        inArray(schema.favorite.entityId, [...docIds]),
      ),
    );
  return rows.map((row) => row.entityId);
}

export async function isFavoriteDoc(principal: Principal, docId: string): Promise<boolean> {
  return (await favoriteDocIds(db, principal, [docId])).length > 0;
}

export async function docsHome(principal: Principal, input: unknown = {}): Promise<DocHome> {
  assertCan(principal, 'doc:read');
  const { limit } = docHomeSchema.parse(input);
  const [recent, favorites, updated] = await Promise.all([
    listRecentDocs(principal, limit),
    listFavoriteDocs(principal, limit),
    listUpdatedDocs(principal, limit),
  ]);
  return { recent, favorites, updated };
}

export interface SavedDocFavorite {
  readonly docId: string;
  readonly favorite: boolean;
  readonly actions: SyncAction[];
}

export async function setDocFavorite(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<SavedDocFavorite> {
  assertCan(principal, 'doc:read');
  const { favorite } = docFavoriteSchema.parse(input);
  const doc = await loadReadableDoc(db, principal, docId);

  return await db.transaction(async (tx) => {
    if (favorite) {
      const [next] = await tx
        .select({ top: sql<number>`coalesce(min(${schema.favorite.sortOrder}), 1024) - 1` })
        .from(schema.favorite)
        .where(
          and(
            eq(schema.favorite.userId, principal.userId),
            eq(schema.favorite.organizationId, principal.organizationId),
            eq(schema.favorite.entityType, DOC_ENTITY),
          ),
        );
      await tx
        .insert(schema.favorite)
        .values({
          id: newId(),
          organizationId: principal.organizationId,
          userId: principal.userId,
          entityType: DOC_ENTITY,
          entityId: doc.id,
          sortOrder: next?.top ?? 1024,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(schema.favorite)
        .where(
          and(
            eq(schema.favorite.userId, principal.userId),
            eq(schema.favorite.organizationId, principal.organizationId),
            eq(schema.favorite.entityType, DOC_ENTITY),
            eq(schema.favorite.entityId, doc.id),
          ),
        );
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    return {
      docId: doc.id,
      favorite,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.user(principal.userId)],
          action: 'update',
          model: 'doc',
          modelId: doc.id,
          data: { id: doc.id, favorite },
          actor,
        }),
      ],
    };
  });
}
