import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.ts';
import type { PrunedTable } from './prune.ts';
import * as schema from './schema/index.ts';

type HistoryDatabase = Database | Transaction;

export const HISTORY_RETENTION = {
  checkActivityDays: 7,
  obsoleteCheckDays: 30,
  documentVersionDays: 30,
  documentVersionLimit: 5,
  batchSize: 1000,
  batchesPerRepository: 10,
} as const;

async function pruneRepositoryBatch(database: HistoryDatabase, repositoryId: string) {
  return await database.transaction(async (tx) => {
    const [repository] = await tx
      .select({
        id: schema.githubRepositorySync.id,
        organizationId: schema.githubRepositorySync.organizationId,
      })
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.id, repositoryId))
      .for('update', { skipLocked: true });
    if (repository === undefined) return { contexts: 0, activities: 0 };

    const contexts = await tx.execute<{ deleted: number }>(sql`
      with candidates as (
        select c.id from github_check_head_context c
        where c.organization_id = ${repository.organizationId} and c.repository_sync_id = ${repositoryId}
          and c.updated_at < now() - make_interval(days => ${HISTORY_RETENTION.obsoleteCheckDays})
          and c.reconciliation_state not in ('unresolved', 'processing')
          and not exists (
            select 1 from github_pull_request p
            where p.organization_id = c.organization_id
              and p.repository_sync_id = c.repository_sync_id
              and p.head_sha = c.head_sha and p.state not in ('closed', 'merged')
          )
          and not exists (
            select 1 from github_check_head_reconciliation h
            where h.organization_id = c.organization_id
              and h.repository_sync_id = c.repository_sync_id
              and h.head_sha = c.head_sha and h.status in ('pending', 'processing')
          )
        limit ${HISTORY_RETENTION.batchSize}
      ), gone as (
        delete from github_check_head_context where id in (select id from candidates)
        returning 1
      ) select count(*)::int as deleted from gone
    `);

    const candidates = await tx.execute<{ id: string }>(sql`
      select a.id from github_check_activity a
      where a.organization_id = ${repository.organizationId} and a.repository_sync_id = ${repositoryId}
        and a.created_at < now() - make_interval(days => ${HISTORY_RETENTION.checkActivityDays})
        and not exists (
          select 1 from github_check_head_context c
          where c.organization_id = a.organization_id
            and c.repository_sync_id = a.repository_sync_id
            and c.head_sha = a.head_sha and c.latest_activity_id = a.id
        )
        and not exists (
          select 1 from github_pull_request_check_context c
          where c.organization_id = a.organization_id
            and c.repository_sync_id = a.repository_sync_id
            and c.head_sha = a.head_sha and c.latest_activity_id = a.id
        )
        and not exists (
          select 1 from github_check_head_reconciliation h
          where h.organization_id = a.organization_id
            and h.repository_sync_id = a.repository_sync_id
            and h.head_sha = a.head_sha and h.status in ('pending', 'processing')
        )
      order by a.created_at, a.id
      limit ${HISTORY_RETENTION.batchSize}
    `);
    const ids = candidates.map((row) => row.id);
    if (ids.length === 0) return { contexts: contexts[0]?.deleted ?? 0, activities: 0 };

    await tx
      .update(schema.githubPullRequestActivity)
      .set({ checkActivityId: null })
      .where(
        and(
          eq(schema.githubPullRequestActivity.organizationId, repository.organizationId),
          inArray(schema.githubPullRequestActivity.checkActivityId, ids),
        ),
      );
    const activities = await tx
      .delete(schema.githubCheckActivity)
      .where(
        and(
          eq(schema.githubCheckActivity.organizationId, repository.organizationId),
          inArray(schema.githubCheckActivity.id, ids),
        ),
      )
      .returning({ id: schema.githubCheckActivity.id });
    return { contexts: contexts[0]?.deleted ?? 0, activities: activities.length };
  });
}

async function pruneDocumentVersions(database: HistoryDatabase) {
  const documents = await database.execute<{ docId: string }>(sql`
    select doc_id as "docId" from doc_version
    group by doc_id
    having count(*) > ${HISTORY_RETENTION.documentVersionLimit}
      or (count(*) > 1 and min(last_saved_at) < now() - make_interval(days => ${HISTORY_RETENTION.documentVersionDays}))
    order by doc_id
    limit ${HISTORY_RETENTION.batchSize}
  `);
  let deleted = 0;
  for (const document of documents) {
    deleted += await database.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: schema.doc.id })
        .from(schema.doc)
        .where(eq(schema.doc.id, document.docId))
        .for('update', { skipLocked: true });
      if (locked === undefined) return 0;
      const rows = await tx.execute<{ deleted: number }>(sql`
        with ranked as (
          select id, last_saved_at,
            row_number() over (order by last_saved_at desc, id desc) as position
          from doc_version where doc_id = ${document.docId}
        ), gone as (
          delete from doc_version where id in (
            select id from ranked where position > 1 and (
              position > ${HISTORY_RETENTION.documentVersionLimit}
              or last_saved_at < now() - make_interval(days => ${HISTORY_RETENTION.documentVersionDays})
            )
          ) returning 1
        ) select count(*)::int as deleted from gone
      `);
      return rows[0]?.deleted ?? 0;
    });
  }
  return deleted;
}

export async function pruneHistoryTables(database: HistoryDatabase): Promise<PrunedTable[]> {
  const repositories = await database
    .select({ id: schema.githubRepositorySync.id })
    .from(schema.githubRepositorySync)
    .orderBy(schema.githubRepositorySync.id);
  let contexts = 0;
  let activities = 0;
  for (const repository of repositories) {
    for (let batch = 0; batch < HISTORY_RETENTION.batchesPerRepository; batch += 1) {
      const pruned = await pruneRepositoryBatch(database, repository.id);
      contexts += pruned.contexts;
      activities += pruned.activities;
      if (
        pruned.activities < HISTORY_RETENTION.batchSize &&
        pruned.contexts < HISTORY_RETENTION.batchSize
      )
        break;
    }
  }
  return [
    {
      table: 'github_check_head_context',
      days: HISTORY_RETENTION.obsoleteCheckDays,
      deleted: contexts,
    },
    {
      table: 'github_check_activity',
      days: HISTORY_RETENTION.checkActivityDays,
      deleted: activities,
    },
    {
      table: 'doc_version',
      days: HISTORY_RETENTION.documentVersionDays,
      deleted: await pruneDocumentVersions(database),
    },
  ];
}
