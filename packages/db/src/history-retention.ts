import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
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
  contextBatchSize: 100,
  batchesPerRun: 10,
  documentsPerRun: 100,
  durationMs: 120_000,
  documentDurationMs: 30_000,
} as const;

function isRetentionTimeout(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current === null || typeof current !== 'object') return false;
    if ('code' in current && current.code === '57014') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

async function limitStatementTime(tx: Transaction, deadline: number) {
  const remaining = Math.max(1, Math.min(20_000, deadline - Date.now()));
  await tx.execute(sql`select set_config('statement_timeout', ${String(remaining)}, true)`);
}

async function nextRepository(
  database: HistoryDatabase,
  visited: readonly string[],
  deadline: number,
) {
  return await database.transaction(async (tx) => {
    if (Date.now() >= deadline) return null;
    await limitStatementTime(tx, deadline);
    const [repository] = await tx
      .select({
        id: schema.githubRepositorySync.id,
        organizationId: schema.githubRepositorySync.organizationId,
      })
      .from(schema.githubRepositorySync)
      .where(
        and(
          visited.length === 0
            ? undefined
            : notInArray(schema.githubRepositorySync.id, [...visited]),
          sql`(exists (
            select 1 from github_check_activity a
            where a.organization_id = ${schema.githubRepositorySync.organizationId}
              and a.repository_sync_id = ${schema.githubRepositorySync.id}
              and a.created_at < now() - make_interval(days => ${HISTORY_RETENTION.checkActivityDays})
          ) or exists (
            select 1 from github_check_head_context c
            where c.organization_id = ${schema.githubRepositorySync.organizationId}
              and c.repository_sync_id = ${schema.githubRepositorySync.id}
              and c.updated_at < now() - make_interval(days => ${HISTORY_RETENTION.obsoleteCheckDays})
          ))`,
        ),
      )
      .orderBy(
        asc(schema.githubRepositorySync.historyPrunedAt),
        asc(schema.githubRepositorySync.id),
      )
      .limit(1)
      .for('update', { skipLocked: true });
    if (repository === undefined) return null;
    const repositoryId = repository.id;
    await tx
      .update(schema.githubRepositorySync)
      .set({ historyPrunedAt: sql`clock_timestamp()` })
      .where(eq(schema.githubRepositorySync.id, repositoryId));

    return repository;
  });
}

async function pruneRepositoryBatch(
  database: HistoryDatabase,
  repository: { readonly id: string; readonly organizationId: string },
  deadline: number,
) {
  return await database.transaction(async (tx) => {
    if (Date.now() >= deadline) return { contexts: 0, activities: 0, deferred: true };
    await limitStatementTime(tx, deadline);
    const repositoryId = repository.id;
    const [locked] = await tx
      .select({ id: schema.githubRepositorySync.id })
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.id, repositoryId))
      .for('update', { skipLocked: true });
    if (locked === undefined) return { contexts: 0, activities: 0, deferred: true };

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
        limit ${HISTORY_RETENTION.contextBatchSize}
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
    if (ids.length === 0)
      return { contexts: contexts[0]?.deleted ?? 0, activities: 0, deferred: false };

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
    return { contexts: contexts[0]?.deleted ?? 0, activities: activities.length, deferred: false };
  });
}

async function pruneDocumentVersions(database: HistoryDatabase, deadline: number) {
  let documents: readonly { readonly docId: string }[];
  try {
    documents = await database.transaction(async (tx) => {
      if (Date.now() >= deadline) return [];
      await limitStatementTime(tx, deadline);
      return await tx.execute<{ docId: string }>(sql`
    select doc_id as "docId" from doc_version
    group by doc_id
    having count(*) > ${HISTORY_RETENTION.documentVersionLimit}
      or (count(*) > 1 and min(last_saved_at) < now() - make_interval(days => ${HISTORY_RETENTION.documentVersionDays}))
    order by doc_id
    limit ${HISTORY_RETENTION.documentsPerRun}
  `);
    });
  } catch (error) {
    if (!isRetentionTimeout(error)) throw error;
    console.warn('Document retention selection exceeded its statement budget.');
    return { deleted: 0, deferred: 1 };
  }
  let deleted = 0;
  let deferred = 0;
  for (const document of documents) {
    if (Date.now() >= deadline) break;
    try {
      deleted += await database.transaction(async (tx) => {
        await limitStatementTime(tx, deadline);
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
            order by position desc
            limit ${HISTORY_RETENTION.batchSize}
          ) returning 1
        ) select count(*)::int as deleted from gone
      `);
        return rows[0]?.deleted ?? 0;
      });
    } catch (error) {
      if (!isRetentionTimeout(error)) throw error;
      deferred += 1;
      console.warn('Document retention deferred a timed-out document.', document.docId);
    }
  }
  return { deleted, deferred };
}

export async function pruneHistoryTables(database: HistoryDatabase): Promise<PrunedTable[]> {
  const deadline = Date.now() + HISTORY_RETENTION.durationMs;
  const documents = await pruneDocumentVersions(
    database,
    Math.min(deadline, Date.now() + HISTORY_RETENTION.documentDurationMs),
  );
  const visited: string[] = [];
  let contexts = 0;
  let activities = 0;
  let deferred = 0;
  for (
    let batch = 0;
    batch < HISTORY_RETENTION.batchesPerRun && Date.now() < deadline;
    batch += 1
  ) {
    let repository: Awaited<ReturnType<typeof nextRepository>>;
    try {
      repository = await nextRepository(database, visited, deadline);
    } catch (error) {
      if (!isRetentionTimeout(error)) throw error;
      deferred += 1;
      console.warn('GitHub retention selection exceeded its statement budget.');
      break;
    }
    if (repository === null) break;
    visited.push(repository.id);
    try {
      const pruned = await pruneRepositoryBatch(database, repository, deadline);
      contexts += pruned.contexts;
      activities += pruned.activities;
      deferred += pruned.deferred ? 1 : 0;
    } catch (error) {
      if (!isRetentionTimeout(error)) throw error;
      deferred += 1;
      console.warn('GitHub retention deferred a timed-out repository.', repository.id);
    }
  }
  return [
    {
      table: 'github_check_head_context',
      days: HISTORY_RETENTION.obsoleteCheckDays,
      deleted: contexts,
      deferred,
    },
    {
      table: 'github_check_activity',
      days: HISTORY_RETENTION.checkActivityDays,
      deleted: activities,
      deferred,
    },
    {
      table: 'doc_version',
      days: HISTORY_RETENTION.documentVersionDays,
      deleted: documents.deleted,
      deferred: documents.deferred,
    },
  ];
}
