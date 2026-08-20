import {
  and,
  asc,
  count,
  db,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  schema,
  sql,
} from '@orbit/db';
import type { NotificationEvent } from '@orbit/services/notifications';
import type { DocAccessLevel } from '@orbit/shared/constants';
import {
  isExternallyShared,
  isPublished,
  isRestricted,
  REBALANCE_THRESHOLD,
  SORT_ORDER_STEP,
} from '@orbit/shared/constants';
import { conflict, forbidden, notFound, validationFailed } from '@orbit/shared/errors';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, can, canReadDoc } from '@orbit/shared/policy';
import {
  docUrl,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  slugify,
  sortOrderBetween,
  truncate,
} from '@orbit/shared/utils';
import {
  DOC_TITLE_LIMIT,
  docAccessSetSchema,
  docCollectionCreateSchema,
  docCollectionUpdateSchema,
  docCreateSchema,
  docDuplicateSchema,
  docFilterSchema,
  docMoveSchema,
  docShareSchema,
  docUpdateSchema,
} from '@orbit/shared/validators';
import { getTableColumns, type SQL } from 'drizzle-orm';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, newToken, requireRow } from '../internal.ts';
import { docReaderIds } from '../notifications/audience.ts';
import { newMentions, resolveHandles } from '../notifications/mentions.ts';
import { NOTIFICATION_BODY_LIMIT, notifyRecipients } from '../notifications/notify.ts';
import { findPrincipal } from '../org/member-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

const DOC_EXCERPT_LENGTH = 400;
const DOC_SNIPPET_LEAD = 48;
const DOC_SNIPPET_LENGTH = 320;

const { searchVector: _searchVector, ...DOC_COLUMNS } = getTableColumns(schema.doc);

export { DOC_COLUMNS };

export type DocRow = Omit<typeof schema.doc.$inferSelect, 'searchVector'>;
export type DocCollectionRow = typeof schema.docCollection.$inferSelect;
export type DocVersionRow = typeof schema.docVersion.$inferSelect;
export type AttachmentRow = typeof schema.attachment.$inferSelect;

const MAX_DEPTH = 32;
const DOC_BACKLINK_LIMIT = 50;
const VERSION_COALESCE_MS = 5 * 60 * 1000;

export function docSlug(title: string): string {
  const base = slugify(title);
  return base.length === 0 ? 'doc' : base;
}

export function publishedDocToken(pathSegment: string): string {
  const trimmed = pathSegment.trim();
  const dash = trimmed.lastIndexOf('-');
  return dash === -1 ? trimmed : trimmed.slice(dash + 1);
}

export interface DocAuthor {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface DocBacklink {
  readonly id: string;
  readonly title: string;
}

export interface DocDetail {
  readonly doc: DocRow;
  readonly attachments: AttachmentRow[];
  readonly author: DocAuthor;
  readonly followers: number;
  readonly backlinks: DocBacklink[];
  readonly access: DocAccessLevel;
}

export interface SavedDoc {
  readonly doc: DocRow;
  readonly actions: SyncAction[];
}

export interface SavedDocCollection {
  readonly collection: DocCollectionRow;
  readonly actions: SyncAction[];
}

function docScopes(row: DocRow, grantedTo: readonly string[] = []): string[] {
  if (isRestricted(row.visibility)) {
    return [scopes.user(row.authorId), scopes.doc(row.id), ...grantedTo];
  }
  const list = [scopes.organization(row.organizationId), scopes.doc(row.id)];
  if (row.projectId !== null) list.push(scopes.project(row.projectId));
  return list;
}

function docAction(
  row: DocRow,
  syncId: number,
  actor: Awaited<ReturnType<typeof principalActor>>,
  action: 'insert' | 'update' | 'delete' | 'archive',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: docScopes(row),
    action,
    model: 'doc',
    modelId: row.id,
    data: docAnnouncement(row),
    actor,
  });
}

function docAnnouncement(row: DocRow): Record<string, unknown> {
  const { content: _body, publishToken, ...rest } = row;
  return { ...rest, publishToken: publishToken === null ? null : 'redacted' };
}

function tokenFor(visibility: string, current: string | null): string | null {
  if (!isPublished(visibility)) return null;
  return current ?? newToken();
}

export function docReadFilter(principal: Principal): SQL {
  if (principal.role === 'admin') return sql`true`;
  const open = inArray(schema.doc.visibility, ['workspace', 'members', 'link', 'public']);

  const grants = db
    .select({ docId: schema.docAccess.docId })
    .from(schema.docAccess)
    .where(
      or(
        and(
          eq(schema.docAccess.subjectType, 'user'),
          eq(schema.docAccess.subjectId, principal.userId),
        ),
        principal.teamIds.length === 0
          ? sql`false`
          : and(
              eq(schema.docAccess.subjectType, 'team'),
              inArray(schema.docAccess.subjectId, [...principal.teamIds]),
            ),
      ),
    );

  const clause = or(
    open,
    eq(schema.doc.authorId, principal.userId),
    inArray(schema.doc.id, grants),
  );
  return clause ?? sql`false`;
}

async function grantedDocIds(
  executor: Executor,
  principal: Principal,
  docIds: readonly string[],
): Promise<string[]> {
  if (docIds.length === 0) return [];
  const rows = await executor
    .select({ docId: schema.docAccess.docId })
    .from(schema.docAccess)
    .where(
      and(
        inArray(schema.docAccess.docId, [...docIds]),
        or(
          and(
            eq(schema.docAccess.subjectType, 'user'),
            eq(schema.docAccess.subjectId, principal.userId),
          ),
          principal.teamIds.length === 0
            ? sql`false`
            : and(
                eq(schema.docAccess.subjectType, 'team'),
                inArray(schema.docAccess.subjectId, [...principal.teamIds]),
              ),
        ),
      ),
    );
  return rows.map((row) => row.docId);
}

async function batchedWriteGrantedDocIds(
  executor: Executor,
  principal: Principal,
  docIds: readonly string[],
): Promise<string[]> {
  if (docIds.length === 0) return [];
  const rows = await executor
    .select({ docId: schema.docAccess.docId })
    .from(schema.docAccess)
    .where(
      and(
        inArray(schema.docAccess.docId, [...docIds]),
        eq(schema.docAccess.level, 'write'),
        or(
          and(
            eq(schema.docAccess.subjectType, 'user'),
            eq(schema.docAccess.subjectId, principal.userId),
          ),
          principal.teamIds.length === 0
            ? sql`false`
            : and(
                eq(schema.docAccess.subjectType, 'team'),
                inArray(schema.docAccess.subjectId, [...principal.teamIds]),
              ),
        ),
      ),
    );
  return rows.map((row) => row.docId);
}

async function writeGrantedDocIds(
  executor: Executor,
  principal: Principal,
  docId: string,
): Promise<boolean> {
  const granted = await batchedWriteGrantedDocIds(executor, principal, [docId]);
  return granted.length > 0;
}

export async function docReadableBy(
  executor: Executor,
  principal: Principal,
  doc: DocRow,
): Promise<boolean> {
  return canReadDoc(principal, doc, await grantedDocIds(executor, principal, [doc.id]));
}

export function evaluateDocAccessLevel(
  principal: Principal,
  doc: DocRow,
  hasWriteGrant: boolean,
): DocAccessLevel {
  if (!can(principal, 'doc:write')) return 'read';
  if (principal.role === 'admin') return 'write';
  if (doc.authorId === principal.userId) return 'write';
  if (!isRestricted(doc.visibility)) return 'write';
  return hasWriteGrant ? 'write' : 'read';
}

export async function docAccessLevel(
  executor: Executor,
  principal: Principal,
  doc: DocRow,
): Promise<DocAccessLevel> {
  const granted = await writeGrantedDocIds(executor, principal, doc.id);
  return evaluateDocAccessLevel(principal, doc, granted);
}

export async function assertDocWritable(
  executor: Executor,
  principal: Principal,
  doc: DocRow,
): Promise<void> {
  if ((await docAccessLevel(executor, principal, doc)) === 'write') return;
  throw forbidden('You only have read access to that doc.');
}

function buildBlockingMessage(blockingReadable: string[], blockingInvisibleCount: number): string {
  const totalBlocking = blockingReadable.length + blockingInvisibleCount;
  const noun = totalBlocking === 1 ? 'page' : 'pages';
  const verb = totalBlocking === 1 ? 'is' : 'are';
  let msg = `${totalBlocking} ${noun} in this folder ${verb} not yours to move`;
  if (blockingReadable.length > 0) {
    msg += `: ${blockingReadable.join(', ')}`;
  }
  if (blockingInvisibleCount > 0) {
    msg +=
      blockingReadable.length > 0
        ? `, and ${blockingInvisibleCount} more you cannot see.`
        : `. You cannot see ${blockingInvisibleCount === 1 ? 'it' : 'them'}.`;
  } else {
    msg += '.';
  }
  return msg;
}

async function assertDocsMovable(
  executor: Executor,
  principal: Principal,
  docsToCheck: DocRow[],
): Promise<void> {
  if (docsToCheck.length === 0) return;
  const docIds = docsToCheck.map((doc) => doc.id);
  const readGrantedArray = await grantedDocIds(executor, principal, docIds);
  const writeGrantedArray = await batchedWriteGrantedDocIds(executor, principal, docIds);
  const writeGrants = new Set(writeGrantedArray);
  const blockingReadable: string[] = [];
  let blockingInvisibleCount = 0;
  for (const doc of docsToCheck) {
    const canWrite = evaluateDocAccessLevel(principal, doc, writeGrants.has(doc.id)) === 'write';
    if (!canWrite) {
      const canRead = canReadDoc(principal, doc, readGrantedArray);
      if (canRead) {
        blockingReadable.push(doc.title);
      } else {
        blockingInvisibleCount++;
      }
    }
  }
  const totalBlocking = blockingReadable.length + blockingInvisibleCount;
  if (totalBlocking > 0) {
    throw forbidden(buildBlockingMessage(blockingReadable, blockingInvisibleCount));
  }
}

function assertMayWiden(principal: Principal, current: DocRow, next: string | undefined): void {
  if (next === undefined) return;
  if (!isRestricted(current.visibility) || isRestricted(next)) return;
  if (principal.role === 'admin' || current.authorId === principal.userId) return;
  throw forbidden('Only the author or an admin can widen who a doc is shared with.');
}

export async function loadReadableDoc(
  executor: Executor,
  principal: Principal,
  docId: string,
): Promise<DocRow> {
  const [row] = await executor
    .select(DOC_COLUMNS)
    .from(schema.doc)
    .where(and(eq(schema.doc.id, docId), eq(schema.doc.organizationId, principal.organizationId)))
    .limit(1);
  const doc = requireRow(row, 'That doc does not exist.');
  const grants = await grantedDocIds(executor, principal, [doc.id]);
  if (!canReadDoc(principal, doc, grants)) throw notFound('That doc does not exist.');
  return doc;
}

async function assertParent(
  executor: Executor,
  principal: Principal,
  docId: string | null,
  parentId: string,
): Promise<void> {
  if (docId !== null && parentId === docId) throw validationFailed('A doc cannot nest in itself.');
  await loadReadableDoc(executor, principal, parentId);

  const rows = await executor.execute<{
    found: number | string;
    cycle: number | string;
    deepest: number | string;
  }>(sql`
    with recursive ancestors as (
      select id, parent_id, 1 as depth
      from doc
      where id = ${parentId} and organization_id = ${principal.organizationId}
      union all
      select d.id, d.parent_id, a.depth + 1
      from doc d
      join ancestors a on d.id = a.parent_id
      where a.depth < ${MAX_DEPTH} and d.organization_id = ${principal.organizationId}
    )
    select
      count(*)::int as found,
      (count(*) filter (where id = ${docId}))::int as cycle,
      coalesce(max(depth), 0)::int as deepest
    from ancestors
  `);

  const summary = rows[0];
  if (summary === undefined || Number(summary['found']) === 0) {
    throw notFound('That parent doc does not exist.');
  }
  if (Number(summary['cycle']) > 0) {
    throw validationFailed('A doc cannot nest inside its own child.');
  }
  if (Number(summary['deepest']) >= MAX_DEPTH) {
    throw validationFailed('That page is nested too deeply to hold another page.');
  }
}

async function assertPlacement(
  executor: Executor,
  principal: Principal,
  placement: {
    collectionId?: string | null | undefined;
    projectId?: string | null | undefined;
    parentId?: string | null | undefined;
  },
  docId: string | null = null,
): Promise<void> {
  const parentId = placement.parentId;
  if (parentId !== undefined && parentId !== null) {
    await assertParent(executor, principal, docId, parentId);
  }

  const collectionId = placement.collectionId;
  if (collectionId !== undefined && collectionId !== null) {
    const [row] = await executor
      .select({ id: schema.docCollection.id })
      .from(schema.docCollection)
      .where(
        and(
          eq(schema.docCollection.id, collectionId),
          eq(schema.docCollection.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    requireRow(row, 'That collection does not exist.');
  }

  const projectId = placement.projectId;
  if (projectId !== undefined && projectId !== null) {
    const [row] = await executor
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    requireRow(row, 'That project does not exist.');
  }
}

export interface DocPlacement {
  readonly collectionId: string | null;
  readonly projectId: string | null;
  readonly parentId: string | null;
}

export interface DocPlacementPatch {
  readonly collectionId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly parentId?: string | null | undefined;
}

export function placementOf(row: Pick<DocRow, keyof DocPlacement>): DocPlacement {
  return {
    collectionId: row.collectionId,
    projectId: row.projectId,
    parentId: row.parentId,
  };
}

export function touchesPlacement(patch: DocPlacementPatch): boolean {
  return (
    patch.collectionId !== undefined ||
    patch.projectId !== undefined ||
    patch.parentId !== undefined
  );
}

export function samePlacement(left: DocPlacement, right: DocPlacement): boolean {
  return (
    left.collectionId === right.collectionId &&
    left.projectId === right.projectId &&
    left.parentId === right.parentId
  );
}

type DocHome = Pick<DocPlacement, 'collectionId' | 'projectId'>;

export function oneHome(current: DocHome, patch: DocPlacementPatch): DocHome {
  if (patch.collectionId != null) return { collectionId: patch.collectionId, projectId: null };
  if (patch.projectId != null) return { collectionId: null, projectId: patch.projectId };
  return {
    collectionId: patch.collectionId === undefined ? current.collectionId : patch.collectionId,
    projectId: patch.projectId === undefined ? current.projectId : patch.projectId,
  };
}

async function resolvePlacement(
  executor: Executor,
  principal: Principal,
  current: DocPlacement,
  patch: DocPlacementPatch,
): Promise<DocPlacement> {
  if (patch.parentId !== undefined && patch.parentId !== null) {
    const [parent] = await executor
      .select({
        collectionId: schema.doc.collectionId,
        projectId: schema.doc.projectId,
      })
      .from(schema.doc)
      .where(
        and(
          eq(schema.doc.id, patch.parentId),
          eq(schema.doc.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const home = requireRow(parent, 'That parent doc does not exist.');
    return { collectionId: home.collectionId, projectId: home.projectId, parentId: patch.parentId };
  }

  const { collectionId, projectId } = oneHome(current, patch);
  const parentId = patch.parentId === undefined ? current.parentId : null;
  if (parentId === null) return { collectionId, projectId, parentId };

  const [parent] = await executor
    .select({ collectionId: schema.doc.collectionId, projectId: schema.doc.projectId })
    .from(schema.doc)
    .where(
      and(eq(schema.doc.id, parentId), eq(schema.doc.organizationId, principal.organizationId)),
    )
    .limit(1);
  if (parent === undefined) return { collectionId, projectId, parentId: null };
  const stays = parent.collectionId === collectionId && parent.projectId === projectId;
  return { collectionId, projectId, parentId: stays ? parentId : null };
}

export interface DocRefMatch {
  readonly id: string;
  readonly title: string;
}

export async function findDocsByRef(
  principal: Principal,
  ref: string,
  includeArchived: boolean,
): Promise<DocRefMatch[]> {
  assertCan(principal, 'doc:read');
  const needle = ref.trim();
  const lifecycle = includeArchived ? [] : [isNull(schema.doc.archivedAt)];
  return await db
    .select({ id: schema.doc.id, title: schema.doc.title })
    .from(schema.doc)
    .where(
      and(
        eq(schema.doc.organizationId, principal.organizationId),
        docReadFilter(principal),
        ...lifecycle,
        or(eq(schema.doc.id, needle), sql`lower(btrim(${schema.doc.title})) = lower(${needle})`),
      ),
    );
}

export async function listDocSiblings(
  principal: Principal,
  placement: DocPlacement,
): Promise<DocRefMatch[]> {
  assertCan(principal, 'doc:read');
  return await db
    .select({ id: schema.doc.id, title: schema.doc.title })
    .from(schema.doc)
    .where(
      and(
        eq(schema.doc.organizationId, principal.organizationId),
        docReadFilter(principal),
        isNull(schema.doc.archivedAt),
        ...siblingFilters(placement),
      ),
    )
    .orderBy(asc(schema.doc.sortOrder), desc(schema.doc.updatedAt));
}

export async function plannedPlacement(
  principal: Principal,
  docId: string,
  patch: DocPlacementPatch,
): Promise<DocPlacement> {
  assertCan(principal, 'doc:read');
  const current = await loadReadableDoc(db, principal, docId);
  return await resolvePlacement(db, principal, placementOf(current), patch);
}

async function adoptDescendants(
  executor: Executor,
  organizationId: string,
  docId: string,
  placement: DocPlacement,
  syncId: number,
): Promise<DocRow[]> {
  return await executor
    .update(schema.doc)
    .set({
      collectionId: placement.collectionId,
      projectId: placement.projectId,
      updatedAt: new Date(),
      syncId,
    })
    .where(
      and(
        eq(schema.doc.organizationId, organizationId),
        sql`${schema.doc.id} in (
          with recursive subtree as (
            select id, 1 as depth from doc
            where parent_id = ${docId} and organization_id = ${organizationId}
            union all
            select child.id, subtree.depth + 1 from doc child
            join subtree on child.parent_id = subtree.id
            where child.organization_id = ${organizationId} and subtree.depth < ${MAX_DEPTH}
          )
          select id from subtree
        )`,
      ),
    )
    .returning(DOC_COLUMNS);
}

async function nextSiblingOrder(
  executor: Executor,
  organizationId: string,
  placement: DocPlacement,
): Promise<number> {
  const [row] = await executor
    .select({ last: sql<number | null>`max(${schema.doc.sortOrder})` })
    .from(schema.doc)
    .where(and(eq(schema.doc.organizationId, organizationId), ...siblingFilters(placement)));
  return (row?.last ?? 0) + SORT_ORDER_STEP;
}

function siblingFilters(placement: DocPlacement): SQL[] {
  return [
    placement.collectionId === null
      ? isNull(schema.doc.collectionId)
      : eq(schema.doc.collectionId, placement.collectionId),
    placement.projectId === null
      ? isNull(schema.doc.projectId)
      : eq(schema.doc.projectId, placement.projectId),
    placement.parentId === null
      ? isNull(schema.doc.parentId)
      : eq(schema.doc.parentId, placement.parentId),
  ];
}

async function orderAfterSibling(
  executor: Executor,
  organizationId: string,
  source: DocRow,
): Promise<number> {
  const [row] = await executor
    .select({ next: sql<number | null>`min(${schema.doc.sortOrder})` })
    .from(schema.doc)
    .where(
      and(
        eq(schema.doc.organizationId, organizationId),
        gt(schema.doc.sortOrder, source.sortOrder),
        ...siblingFilters({
          collectionId: source.collectionId,
          projectId: source.projectId,
          parentId: source.parentId,
        }),
      ),
    );
  const next = row?.next ?? null;
  return next === null
    ? source.sortOrder + SORT_ORDER_STEP
    : sortOrderBetween(source.sortOrder, next);
}

async function siblingOrderOf(
  executor: Executor,
  organizationId: string,
  placement: DocPlacement,
  docId: string | null,
): Promise<number | null> {
  if (docId === null) return null;
  const [row] = await executor
    .select({ sortOrder: schema.doc.sortOrder })
    .from(schema.doc)
    .where(
      and(
        eq(schema.doc.id, docId),
        eq(schema.doc.organizationId, organizationId),
        ...siblingFilters(placement),
      ),
    )
    .limit(1);
  return row?.sortOrder ?? null;
}

async function renumber(
  executor: Executor,
  scope: SQL,
  base: number,
  syncId: number,
): Promise<DocRow[]> {
  await executor.execute(sql`
    update ${schema.doc} as target
    set sort_order = ${base} + seat.rank * ${SORT_ORDER_STEP}, sync_id = ${syncId}
    from (
      select id, row_number() over (order by sort_order, created_at) as rank
      from ${schema.doc}
      where ${scope}
    ) as seat
    where target.id = seat.id
  `);
  return await executor
    .select(DOC_COLUMNS)
    .from(schema.doc)
    .where(scope)
    .orderBy(asc(schema.doc.sortOrder));
}

async function rebalanceSiblings(
  executor: Executor,
  organizationId: string,
  placement: DocPlacement,
  syncId: number,
): Promise<DocRow[]> {
  const scope = and(eq(schema.doc.organizationId, organizationId), ...siblingFilters(placement));
  if (scope === undefined) return [];
  return await renumber(executor, scope, 0, syncId);
}

export interface MovedPlacement {
  readonly id: string;
  readonly collectionId: string | null;
  readonly projectId: string | null;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly syncId: number;
}

export function movedPlacement(row: DocRow): MovedPlacement {
  return {
    id: row.id,
    collectionId: row.collectionId,
    projectId: row.projectId,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    syncId: row.syncId,
  };
}

export interface MovedDoc extends SavedDoc {
  readonly moved: MovedPlacement[];
}

export async function moveDoc(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<MovedDoc> {
  assertCan(principal, 'doc:write');
  const parsed = docMoveSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadReadableDoc(tx, principal, docId);
    await assertDocWritable(tx, principal, current);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');
    await assertPlacement(tx, principal, parsed, docId);

    const placement = await resolvePlacement(tx, principal, placementOf(current), parsed);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    const anchor = (docId: string | null) =>
      siblingOrderOf(tx, principal.organizationId, placement, docId);

    let before = await anchor(parsed.beforeId);
    let after = await anchor(parsed.afterId);
    let rebalanced: DocRow[] = [];
    if (before !== null && after !== null && Math.abs(after - before) < REBALANCE_THRESHOLD) {
      rebalanced = await rebalanceSiblings(tx, principal.organizationId, placement, syncId);
      before = await anchor(parsed.beforeId);
      after = await anchor(parsed.afterId);
    }

    const landing =
      before === null && after === null
        ? await nextSiblingOrder(tx, principal.organizationId, placement)
        : sortOrderBetween(before, after);

    const [saved] = await tx
      .update(schema.doc)
      .set({
        ...placement,
        sortOrder: landing,
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning(DOC_COLUMNS);
    const doc = requireRow(saved, 'That doc does not exist.');

    const descendants = samePlacement(placement, placementOf(current))
      ? []
      : await adoptDescendants(tx, principal.organizationId, docId, placement, syncId);

    const touched = [...rebalanced.filter((row) => row.id !== doc.id), ...descendants];
    const moved = touched.map(movedPlacement);
    return {
      doc,
      moved,
      actions: [
        docAction(doc, syncId, actor, 'update'),
        ...touched.map((row) => docAction(row, syncId, actor, 'update')),
      ],
    };
  });
}

export interface DocListRow extends Omit<DocRow, 'content'> {
  readonly content: string;
  readonly excerpt: string;
  readonly snippet: string;
  readonly titleMatch: boolean;
  readonly rank: number;
}

function docLikePattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
}

const LEXEME_MIN_LENGTH = 3;

export function usesLexemes(term: string): boolean {
  return term.trim().length >= LEXEME_MIN_LENGTH;
}

function tsQuery(term: string): SQL {
  return sql`websearch_to_tsquery('english', ${term})`;
}

function matchExpression(term: string): SQL<boolean> {
  const title = sql<boolean>`(${schema.doc.title} ilike ${docLikePattern(term)})`;
  if (!usesLexemes(term)) return title;
  return sql<boolean>`(${schema.doc.searchVector} @@ ${tsQuery(term)} or ${title})`;
}

function rankExpression(term: string | null): SQL<number> {
  if (term === null || !usesLexemes(term)) return sql<number>`cast(0 as real)`;
  return sql<number>`ts_rank_cd(${schema.doc.searchVector}, ${tsQuery(term)})`;
}

function bodyMatchExpression(term: string): SQL<boolean> {
  return sql<boolean>`(ts_filter(${schema.doc.searchVector}, '{b}') @@ ${tsQuery(term)})`;
}

function titleMatchExpression(term: string | null): SQL<boolean> {
  if (term === null) return sql<boolean>`false`;
  return sql<boolean>`(${schema.doc.title} ilike ${docLikePattern(term)})`;
}

const HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START},StopSel=${HIGHLIGHT_END},MaxWords=34,MinWords=16,ShortWord=0,MaxFragments=2,FragmentDelimiter=" … "`;

function snippetExpression(term: string | null): SQL<string> {
  if (term === null) return sql<string>`''`;
  if (!usesLexemes(term)) {
    const at = sql`strpos(lower(${schema.doc.content}), lower(${term}))`;
    return sql<string>`case
      when ${at} = 0 then ''
      when ${at} > ${DOC_SNIPPET_LEAD}
        then '…' || substr(${schema.doc.content}, ${at} - ${DOC_SNIPPET_LEAD}, ${DOC_SNIPPET_LENGTH})
      else substr(${schema.doc.content}, 1, ${DOC_SNIPPET_LENGTH})
    end`;
  }
  return sql<string>`case
    when ${bodyMatchExpression(term)}
      then ts_headline('english', ${schema.doc.content}, ${tsQuery(term)}, ${HEADLINE_OPTIONS})
    else ''
  end`;
}

function docListColumns(term: string | null) {
  return {
    ...DOC_COLUMNS,
    content: sql<string>`''`,
    excerpt: sql<string>`left(${schema.doc.content}, ${DOC_EXCERPT_LENGTH})`,
    snippet: snippetExpression(term),
    titleMatch: titleMatchExpression(term),
    rank: rankExpression(term),
  };
}

export async function listDocs(principal: Principal, input: unknown = {}): Promise<DocListRow[]> {
  assertCan(principal, 'doc:read');
  const filter = docFilterSchema.parse(input);
  const term = filter.query !== undefined && filter.query.length > 0 ? filter.query : null;

  const conditions = [
    eq(schema.doc.organizationId, principal.organizationId),
    docReadFilter(principal),
  ];
  if (!filter.includeArchived) conditions.push(isNull(schema.doc.archivedAt));
  if (filter.collectionId !== undefined) {
    conditions.push(eq(schema.doc.collectionId, filter.collectionId));
  }
  if (filter.unfiled) conditions.push(isNull(schema.doc.collectionId));
  if (filter.projectId !== undefined) conditions.push(eq(schema.doc.projectId, filter.projectId));
  if (term !== null) conditions.push(matchExpression(term));

  const order =
    term === null
      ? [asc(schema.doc.sortOrder), desc(schema.doc.updatedAt)]
      : [desc(titleMatchExpression(term)), desc(rankExpression(term)), desc(schema.doc.updatedAt)];

  return await db
    .select(docListColumns(term))
    .from(schema.doc)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(filter.limit);
}

export interface DocCollectionWithCount extends DocCollectionRow {
  readonly docCount: number;
}

export async function listDocCollections(principal: Principal): Promise<DocCollectionWithCount[]> {
  assertCan(principal, 'doc:read');
  const readable = and(
    eq(schema.doc.collectionId, schema.docCollection.id),
    isNull(schema.doc.archivedAt),
    docReadFilter(principal),
  );
  return await db
    .select({
      ...getTableColumns(schema.docCollection),
      docCount: sql<number>`(select count(*)::int from ${schema.doc} where ${readable})`,
    })
    .from(schema.docCollection)
    .where(eq(schema.docCollection.organizationId, principal.organizationId))
    .orderBy(asc(schema.docCollection.position), asc(schema.docCollection.name));
}

async function attachmentsFor(docId: string): Promise<AttachmentRow[]> {
  return await db
    .select()
    .from(schema.attachment)
    .where(and(eq(schema.attachment.parentType, 'doc'), eq(schema.attachment.parentId, docId)))
    .orderBy(asc(schema.attachment.createdAt));
}

export async function listDocBacklinks(
  doc: DocRow,
  principal: Principal | null,
): Promise<DocBacklink[]> {
  if (principal === null) return [];
  return await db
    .select({ id: schema.doc.id, title: schema.doc.title })
    .from(schema.doc)
    .where(
      and(
        eq(schema.doc.organizationId, doc.organizationId),
        isNull(schema.doc.archivedAt),
        ne(schema.doc.id, doc.id),
        ilike(schema.doc.content, `%/docs/${doc.id}%`),
        docReadFilter(principal),
      ),
    )
    .orderBy(asc(schema.doc.title))
    .limit(DOC_BACKLINK_LIMIT);
}

async function detailFor(doc: DocRow, principal: Principal | null): Promise<DocDetail> {
  const [author] = await db
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, doc.authorId))
    .limit(1);
  const [followers] = await db
    .select({ total: count() })
    .from(schema.docSubscription)
    .where(eq(schema.docSubscription.docId, doc.id));

  return {
    doc,
    attachments: await attachmentsFor(doc.id),
    author: author ?? { id: doc.authorId, name: 'Someone', image: null },
    followers: followers?.total ?? 0,
    backlinks: await listDocBacklinks(doc, principal),
    access: principal === null ? 'read' : await docAccessLevel(db, principal, doc),
  };
}

export async function getDoc(principal: Principal, docId: string): Promise<DocDetail> {
  assertCan(principal, 'doc:read');
  return await detailFor(await loadReadableDoc(db, principal, docId), principal);
}

export type PublishedDocResolution =
  | { readonly status: 'missing' }
  | { readonly status: 'sign-in' }
  | { readonly status: 'ok'; readonly detail: DocDetail };

async function publishedDocByToken(pathSegment: string): Promise<DocRow | null> {
  const token = publishedDocToken(pathSegment);
  if (token.length === 0) return null;
  const [doc] = await db
    .select(DOC_COLUMNS)
    .from(schema.doc)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.doc.organizationId))
    .where(
      and(
        eq(schema.doc.publishToken, token),
        isNull(schema.doc.archivedAt),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);
  return doc ?? null;
}

export async function resolvePublishedDoc(
  pathSegment: string,
  viewerUserId: string | null,
): Promise<PublishedDocResolution> {
  const doc = await publishedDocByToken(pathSegment);
  if (doc === null) return { status: 'missing' };
  if (isExternallyShared(doc.visibility)) {
    return { status: 'ok', detail: await detailFor(doc, null) };
  }
  if (doc.visibility !== 'members') return { status: 'missing' };
  if (viewerUserId === null) return { status: 'sign-in' };
  const principal = await findPrincipal(viewerUserId, doc.organizationId);
  if (principal === null) return { status: 'missing' };
  return { status: 'ok', detail: await detailFor(doc, principal) };
}

export async function getPublishedDoc(pathSegment: string): Promise<DocDetail | null> {
  const result = await resolvePublishedDoc(pathSegment, null);
  return result.status === 'ok' ? result.detail : null;
}

export async function listPublicDocs(): Promise<DocRow[]> {
  return await db
    .select(DOC_COLUMNS)
    .from(schema.doc)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.doc.organizationId))
    .where(
      and(
        eq(schema.doc.visibility, 'public'),
        isNull(schema.doc.archivedAt),
        ne(schema.doc.publishToken, ''),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .orderBy(desc(schema.doc.updatedAt))
    .limit(5000);
}

export async function isPublishedDoc(docId: string): Promise<boolean> {
  const [row] = await db
    .select({ visibility: schema.doc.visibility, archivedAt: schema.doc.archivedAt })
    .from(schema.doc)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.doc.organizationId))
    .where(and(eq(schema.doc.id, docId), isNull(schema.organization.deletionRequestedAt)))
    .limit(1);
  return row !== undefined && row.archivedAt === null && isPublished(row.visibility);
}

async function docMentionNotifications(
  tx: Executor,
  principal: Principal,
  doc: DocRow,
  handles: readonly string[],
  actor: Actor,
): Promise<SyncAction[]> {
  const mentioned = await resolveHandles(tx, principal.organizationId, handles, null);
  const readers = await docReaderIds(tx, doc, mentioned);
  const events: NotificationEvent[] = [
    {
      organizationId: doc.organizationId,
      type: 'mention',
      reason: 'mentioned',
      actor,
      entityType: 'doc',
      entityId: doc.id,
      userIds: mentioned.filter((id) => id !== principal.userId && readers.has(id)),
      title: `Mentioned you in ${doc.title}`,
      body: truncate(doc.content, NOTIFICATION_BODY_LIMIT),
      url: docUrl(doc.id),
    },
  ];
  return await notifyRecipients(tx, events);
}

export async function createDoc(principal: Principal, input: unknown): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');
  const parsed = docCreateSchema.parse(input);
  if (isPublished(parsed.visibility)) assertCan(principal, 'doc:publish');

  return await db.transaction(async (tx) => {
    await assertPlacement(tx, principal, parsed);
    const placement = await resolvePlacement(
      tx,
      principal,
      { collectionId: null, projectId: null, parentId: null },
      parsed,
    );
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.doc)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        ...placement,
        title: parsed.title,
        slug: docSlug(parsed.title),
        kind: parsed.kind,
        content: parsed.content,
        sortOrder: await nextSiblingOrder(tx, principal.organizationId, placement),
        visibility: parsed.visibility,
        publishToken: tokenFor(parsed.visibility, null),
        authorId: principal.userId,
        syncId,
      })
      .returning(DOC_COLUMNS);
    const doc = requireRow(created, 'The doc could not be created.');

    await tx
      .insert(schema.docSubscription)
      .values({ id: newId(), docId: doc.id, userId: principal.userId })
      .onConflictDoNothing();
    await snapshotVersion(tx, principal, doc, null);

    const notifications = await docMentionNotifications(
      tx,
      principal,
      doc,
      newMentions('', doc.content),
      actor,
    );

    return { doc, actions: [docAction(doc, syncId, actor, 'insert'), ...notifications] };
  });
}

const COPY_SUFFIX = ' (copy)';

function copyTitle(title: string): string {
  const room = DOC_TITLE_LIMIT - COPY_SUFFIX.length;
  return `${title.length > room ? title.slice(0, room).trimEnd() : title}${COPY_SUFFIX}`;
}

function copyVisibility(visibility: string): string {
  return isPublished(visibility) ? 'workspace' : visibility;
}

export async function duplicateDoc(
  principal: Principal,
  docId: string,
  input: unknown = {},
): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');
  const parsed = docDuplicateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const source = await loadReadableDoc(tx, principal, docId);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const title = parsed.title ?? copyTitle(source.title);
    const [created] = await tx
      .insert(schema.doc)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        collectionId: source.collectionId,
        projectId: source.projectId,
        parentId: source.parentId,
        title,
        slug: docSlug(title),
        kind: source.kind,
        content: source.content,
        sortOrder: await orderAfterSibling(tx, principal.organizationId, source),
        visibility: copyVisibility(source.visibility),
        publishToken: null,
        authorId: principal.userId,
        syncId,
      })
      .returning(DOC_COLUMNS);
    const doc = requireRow(created, 'The doc could not be duplicated.');

    await tx
      .insert(schema.docSubscription)
      .values({ id: newId(), docId: doc.id, userId: principal.userId })
      .onConflictDoNothing();
    await snapshotVersion(tx, principal, doc, null);

    return { doc, actions: [docAction(doc, syncId, actor, 'insert')] };
  });
}

async function snapshotVersion(
  executor: Executor,
  principal: Principal,
  doc: DocRow,
  restoredFromId: string | null,
): Promise<void> {
  const now = new Date();
  if (restoredFromId === null) {
    const [latest] = await executor
      .select({
        id: schema.docVersion.id,
        ownedById: schema.docVersion.ownedById,
        lastSavedAt: schema.docVersion.lastSavedAt,
        same: sql<boolean>`${schema.docVersion.title} = ${doc.title}
          and ${schema.docVersion.content} = ${doc.content}`,
      })
      .from(schema.docVersion)
      .where(eq(schema.docVersion.docId, doc.id))
      .orderBy(desc(schema.docVersion.lastSavedAt))
      .limit(1);

    if (latest?.same === true) return;
    if (
      latest !== undefined &&
      latest.ownedById === principal.userId &&
      now.getTime() - latest.lastSavedAt.getTime() < VERSION_COALESCE_MS
    ) {
      await executor
        .update(schema.docVersion)
        .set({ title: doc.title, content: doc.content, lastSavedAt: now })
        .where(eq(schema.docVersion.id, latest.id));
      return;
    }
  }

  await executor.insert(schema.docVersion).values({
    id: newId(),
    docId: doc.id,
    organizationId: doc.organizationId,
    title: doc.title,
    content: doc.content,
    ownedById: principal.userId,
    restoredFromId,
    lastSavedAt: now,
  });
}

export async function updateDoc(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');
  const parsed = docUpdateSchema.parse(input);
  if (parsed.visibility !== undefined && isPublished(parsed.visibility)) {
    assertCan(principal, 'doc:publish');
  }

  return await db.transaction(async (tx) => {
    const current = await loadReadableDoc(tx, principal, docId);
    await assertDocWritable(tx, principal, current);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');
    assertMayWiden(principal, current, parsed.visibility);
    await assertPlacement(tx, principal, parsed, docId);

    const placement = touchesPlacement(parsed)
      ? await resolvePlacement(tx, principal, placementOf(current), parsed)
      : placementOf(current);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({
        ...parsed,
        ...placement,
        ...(samePlacement(placement, placementOf(current))
          ? {}
          : { sortOrder: await nextSiblingOrder(tx, principal.organizationId, placement) }),
        ...(current.slug.length === 0 ? { slug: docSlug(parsed.title ?? current.title) } : {}),
        ...(parsed.visibility === undefined
          ? {}
          : { publishToken: tokenFor(parsed.visibility, current.publishToken) }),
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning(DOC_COLUMNS);
    const doc = requireRow(saved, 'That doc does not exist.');
    if (doc.title !== current.title || doc.content !== current.content) {
      await snapshotVersion(tx, principal, doc, null);
    }

    const descendants = samePlacement(placement, placementOf(current))
      ? []
      : await adoptDescendants(tx, principal.organizationId, docId, placement, syncId);

    const notifications = await docMentionNotifications(
      tx,
      principal,
      doc,
      newMentions(current.content, doc.content),
      actor,
    );

    return {
      doc,
      actions: [
        docAction(doc, syncId, actor, 'update'),
        ...descendants.map((row) => docAction(row, syncId, actor, 'update')),
        ...notifications,
      ],
    };
  });
}

export async function listDocVersions(
  principal: Principal,
  docId: string,
): Promise<DocVersionRow[]> {
  assertCan(principal, 'doc:read');
  await loadReadableDoc(db, principal, docId);
  return await db
    .select()
    .from(schema.docVersion)
    .where(eq(schema.docVersion.docId, docId))
    .orderBy(desc(schema.docVersion.lastSavedAt))
    .limit(100);
}

export async function restoreDocVersion(
  principal: Principal,
  docId: string,
  versionId: string,
): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');

  return await db.transaction(async (tx) => {
    const current = await loadReadableDoc(tx, principal, docId);
    await assertDocWritable(tx, principal, current);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');

    const [found] = await tx
      .select()
      .from(schema.docVersion)
      .where(and(eq(schema.docVersion.id, versionId), eq(schema.docVersion.docId, docId)))
      .limit(1);
    const version = requireRow(found, 'That version does not exist.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({
        title: version.title,
        content: version.content,
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning(DOC_COLUMNS);
    const doc = requireRow(saved, 'That doc does not exist.');
    await snapshotVersion(tx, principal, doc, version.id);

    return { doc, actions: [docAction(doc, syncId, actor, 'update')] };
  });
}

export async function archiveDoc(
  principal: Principal,
  docId: string,
  archived = true,
): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');

  return await db.transaction(async (tx) => {
    await assertDocWritable(tx, principal, await loadReadableDoc(tx, principal, docId));
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date(), syncId })
      .where(eq(schema.doc.id, docId))
      .returning(DOC_COLUMNS);
    const doc = requireRow(saved, 'That doc does not exist.');

    return { doc, actions: [docAction(doc, syncId, actor, archived ? 'archive' : 'update')] };
  });
}

export interface DeletedDoc {
  readonly promoted: DocRow[];
  readonly actions: SyncAction[];
}

async function promoteChildren(
  executor: Executor,
  parent: DocRow,
  syncId: number,
): Promise<DocRow[]> {
  const placement: DocPlacement = {
    collectionId: parent.collectionId,
    projectId: parent.projectId,
    parentId: parent.parentId,
  };
  const base = await nextSiblingOrder(executor, parent.organizationId, placement);
  const lifted = await executor
    .update(schema.doc)
    .set({ parentId: parent.parentId, updatedAt: new Date(), syncId })
    .where(
      and(eq(schema.doc.organizationId, parent.organizationId), eq(schema.doc.parentId, parent.id)),
    )
    .returning({ id: schema.doc.id });
  if (lifted.length === 0) return [];
  return await renumber(
    executor,
    inArray(
      schema.doc.id,
      lifted.map((row) => row.id),
    ),
    base - SORT_ORDER_STEP,
    syncId,
  );
}

export async function deleteDoc(principal: Principal, docId: string): Promise<DeletedDoc> {
  assertCan(principal, 'doc:write');

  return await db.transaction(async (tx) => {
    const current = await loadReadableDoc(tx, principal, docId);
    if (principal.role !== 'admin' && current.authorId !== principal.userId) {
      throw forbidden('Only the author or an admin can delete a doc for good.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const promoted = await promoteChildren(tx, current, syncId);

    await tx
      .delete(schema.attachment)
      .where(and(eq(schema.attachment.parentType, 'doc'), eq(schema.attachment.parentId, docId)));
    await tx
      .delete(schema.favorite)
      .where(and(eq(schema.favorite.entityType, 'doc'), eq(schema.favorite.entityId, docId)));
    await tx
      .delete(schema.recentVisit)
      .where(and(eq(schema.recentVisit.entityType, 'doc'), eq(schema.recentVisit.entityId, docId)));
    await tx.delete(schema.doc).where(eq(schema.doc.id, docId));

    return {
      promoted,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: current.organizationId,
          scopes: docScopes(current),
          action: 'delete',
          model: 'doc',
          modelId: docId,
          data: { id: docId, collectionId: current.collectionId, projectId: current.projectId },
          actor,
        }),
        ...promoted.map((row) => docAction(row, syncId, actor, 'update')),
      ],
    };
  });
}

export interface SharedDoc extends SavedDoc {
  readonly publishToken: string | null;
}

export async function shareDoc(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<SharedDoc> {
  assertCan(principal, 'doc:write');
  const { visibility, rotateToken } = docShareSchema.parse(input);
  if (isPublished(visibility)) assertCan(principal, 'doc:publish');

  return await db.transaction(async (tx) => {
    const current = await loadReadableDoc(tx, principal, docId);
    await assertDocWritable(tx, principal, current);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');
    assertMayWiden(principal, current, visibility);

    const publishToken = tokenFor(visibility, rotateToken ? null : current.publishToken);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({
        visibility,
        publishToken,
        ...(current.slug.length === 0 ? { slug: docSlug(current.title) } : {}),
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning(DOC_COLUMNS);
    const doc = requireRow(saved, 'That doc does not exist.');

    return { doc, publishToken, actions: [docAction(doc, syncId, actor, 'update')] };
  });
}

export async function createDocCollection(
  principal: Principal,
  input: unknown,
): Promise<SavedDocCollection> {
  assertCan(principal, 'doc:write');
  const parsed = docCollectionCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [last] = await tx
      .select({ position: sql<number | null>`max(${schema.docCollection.position})` })
      .from(schema.docCollection)
      .where(eq(schema.docCollection.organizationId, principal.organizationId));
    const [created] = await tx
      .insert(schema.docCollection)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        name: parsed.name,
        icon: parsed.icon,
        position: (last?.position ?? 0) + SORT_ORDER_STEP,
        syncId,
      })
      .returning();
    const collection = requireRow(created, 'The collection could not be created.');

    return { collection, actions: [collectionAction(collection, syncId, actor, 'insert')] };
  });
}

function collectionAction(
  row: DocCollectionRow,
  syncId: number,
  actor: Awaited<ReturnType<typeof principalActor>>,
  action: 'insert' | 'update' | 'delete',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: [scopes.organization(row.organizationId)],
    action,
    model: 'doc_collection',
    modelId: row.id,
    data: row,
    actor,
  });
}

export async function updateDocCollection(
  principal: Principal,
  collectionId: string,
  input: unknown,
): Promise<SavedDocCollection> {
  assertCan(principal, 'doc:write');
  const parsed = docCollectionUpdateSchema.parse(input);
  if (Object.keys(parsed).length === 0) throw validationFailed('Nothing to change.');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.docCollection)
      .set({ ...parsed, syncId })
      .where(
        and(
          eq(schema.docCollection.id, collectionId),
          eq(schema.docCollection.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const collection = requireRow(saved, 'That collection does not exist.');

    return { collection, actions: [collectionAction(collection, syncId, actor, 'update')] };
  });
}

async function emptyCollection(
  executor: Executor,
  collectionId: string,
  syncId: number,
  reassignToId: string | null,
  principal: Principal,
): Promise<DocRow[]> {
  const organizationId = principal.organizationId;
  await executor
    .select({ id: schema.docCollection.id })
    .from(schema.docCollection)
    .where(
      and(
        eq(schema.docCollection.organizationId, organizationId),
        eq(schema.docCollection.id, collectionId),
      ),
    )
    .for('update');
  const docsToCheck = await executor
    .select(DOC_COLUMNS)
    .from(schema.doc)
    .where(
      and(eq(schema.doc.organizationId, organizationId), eq(schema.doc.collectionId, collectionId)),
    );
  if (docsToCheck.length === 0) return [];
  await assertDocsMovable(executor, principal, docsToCheck);
  const docIds = docsToCheck.map((doc) => doc.id);
  const base = await nextSiblingOrder(executor, organizationId, {
    collectionId: reassignToId,
    projectId: null,
    parentId: null,
  });
  const orphaned = await executor
    .update(schema.doc)
    .set({ collectionId: reassignToId, updatedAt: new Date(), syncId })
    .where(
      and(
        eq(schema.doc.organizationId, organizationId),
        eq(schema.doc.collectionId, collectionId),
        inArray(schema.doc.id, docIds),
      ),
    )
    .returning({ id: schema.doc.id, parentId: schema.doc.parentId });
  if (orphaned.length === 0) return [];
  const roots = orphaned.filter((row) => row.parentId === null).map((row) => row.id);
  if (roots.length > 0) {
    await renumber(executor, inArray(schema.doc.id, roots), base - SORT_ORDER_STEP, syncId);
  }
  return await executor
    .select(DOC_COLUMNS)
    .from(schema.doc)
    .where(
      inArray(
        schema.doc.id,
        orphaned.map((row) => row.id),
      ),
    );
}

export async function deleteDocCollection(
  principal: Principal,
  collectionId: string,
  reassignToId: string | null = null,
): Promise<SyncAction[]> {
  assertCan(principal, 'doc:write');
  if (reassignToId === collectionId) {
    throw validationFailed('A collection cannot take over its own pages.');
  }
  return await db.transaction(async (tx) => {
    if (reassignToId !== null) {
      const [target] = await tx
        .select({ id: schema.docCollection.id })
        .from(schema.docCollection)
        .where(
          and(
            eq(schema.docCollection.id, reassignToId),
            eq(schema.docCollection.organizationId, principal.organizationId),
          ),
        )
        .limit(1);
      requireRow(target, 'That collection does not exist.');
    }
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const homeless = await emptyCollection(tx, collectionId, syncId, reassignToId, principal);
    const [removed] = await tx
      .delete(schema.docCollection)
      .where(
        and(
          eq(schema.docCollection.id, collectionId),
          eq(schema.docCollection.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const collection = requireRow(removed, 'That collection does not exist.');
    return [
      collectionAction(collection, syncId, actor, 'delete'),
      ...homeless.map((row) => docAction(row, syncId, actor, 'update')),
    ];
  });
}

export interface DocAccessGrant {
  readonly subjectType: 'user' | 'team';
  readonly subjectId: string;
  readonly level: 'read' | 'write';
}

export async function listDocAccess(
  principal: Principal,
  docId: string,
): Promise<(typeof schema.docAccess.$inferSelect)[]> {
  assertCan(principal, 'doc:read');
  await loadReadableDoc(db, principal, docId);
  return await db
    .select()
    .from(schema.docAccess)
    .where(eq(schema.docAccess.docId, docId))
    .orderBy(asc(schema.docAccess.createdAt));
}

async function assertSubjectsInWorkspace(
  executor: Executor,
  organizationId: string,
  grants: readonly DocAccessGrant[],
): Promise<void> {
  const userIds = [
    ...new Set(grants.filter((g) => g.subjectType === 'user').map((g) => g.subjectId)),
  ];
  const teamIds = [
    ...new Set(grants.filter((g) => g.subjectType === 'team').map((g) => g.subjectId)),
  ];

  if (userIds.length > 0) {
    const members = await executor
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          inArray(schema.member.userId, userIds),
        ),
      );
    if (members.length !== userIds.length) {
      throw validationFailed('You can only share with people in this workspace.');
    }
  }

  if (teamIds.length > 0) {
    const teams = await executor
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(and(eq(schema.team.organizationId, organizationId), inArray(schema.team.id, teamIds)));
    if (teams.length !== teamIds.length) {
      throw validationFailed('You can only share with teams in this workspace.');
    }
  }
}

export interface SavedDocAccess {
  readonly grants: (typeof schema.docAccess.$inferSelect)[];
  readonly actions: SyncAction[];
}

export async function setDocAccess(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<SavedDocAccess> {
  assertCan(principal, 'doc:write');
  const parsed = docAccessSetSchema.parse(input);
  const doc = await loadReadableDoc(db, principal, docId);
  if (principal.role !== 'admin' && doc.authorId !== principal.userId) {
    throw forbidden('Only the author or an admin can change who a doc is shared with.');
  }

  const unique = new Map<string, DocAccessGrant>();
  for (const grant of parsed.grants) {
    unique.set(`${grant.subjectType}:${grant.subjectId}`, grant);
  }
  const grants = [...unique.values()];

  return await db.transaction(async (tx) => {
    await assertSubjectsInWorkspace(tx, principal.organizationId, grants);
    await tx.delete(schema.docAccess).where(eq(schema.docAccess.docId, docId));
    const syncId = await nextSyncId(tx);
    const saved =
      grants.length === 0
        ? []
        : await tx
            .insert(schema.docAccess)
            .values(
              grants.map((grant) => ({
                id: newId(),
                organizationId: principal.organizationId,
                docId,
                subjectType: grant.subjectType,
                subjectId: grant.subjectId,
                level: grant.level,
                grantedById: principal.userId,
                syncId,
              })),
            )
            .returning();

    const [touched] = await tx
      .update(schema.doc)
      .set({ syncId, updatedAt: new Date() })
      .where(eq(schema.doc.id, docId))
      .returning(DOC_COLUMNS);
    const row = requireRow(touched, 'That doc does not exist.');
    const actor = await principalActor(tx, principal);
    const reach = [
      ...docScopes(row),
      ...grants.map((grant) =>
        grant.subjectType === 'user' ? scopes.user(grant.subjectId) : scopes.team(grant.subjectId),
      ),
    ];

    return {
      grants: saved,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [...new Set(reach)],
          action: 'update',
          model: 'doc',
          modelId: row.id,
          data: docAnnouncement(row),
          actor,
        }),
      ],
    };
  });
}
