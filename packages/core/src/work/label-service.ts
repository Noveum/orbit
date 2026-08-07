import { and, asc, db, eq, inArray, isNull, or, type SQL, schema } from '@orbit/db';
import { conflict, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { labelCreateSchema, labelUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, isUniqueViolation, newId, requireRow } from '../internal.ts';
import { requireTeam } from '../org/team-service.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type LabelRow = typeof schema.label.$inferSelect;

export const STARTER_LABELS: readonly { name: string; color: string }[] = [
  { name: 'Bug', color: '#EF4444' },
  { name: 'Feature', color: '#22C55E' },
  { name: 'Improvement', color: '#3B82F6' },
  { name: 'Design', color: '#EC4899' },
  { name: 'Documentation', color: '#A855F7' },
  { name: 'Chore', color: '#6B7280' },
];

const NAME_TAKEN = 'A label with that name already lives here.';
const MISSING_LABEL = 'That label does not exist.';

async function refusingDuplicates<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(NAME_TAKEN);
    throw error;
  }
}

function labelScopes(row: Pick<LabelRow, 'organizationId' | 'teamId'>): string[] {
  if (row.teamId === null) return [scopes.organization(row.organizationId)];
  return [scopes.team(row.teamId)];
}

function bothAudiences(before: LabelRow, after: LabelRow): string[] {
  return [...new Set([...labelScopes(before), ...labelScopes(after)])];
}

function readableLabels(principal: Principal): SQL {
  const owned = eq(schema.label.organizationId, principal.organizationId);
  if (principal.role === 'admin') return owned;
  const workspaceWide = isNull(schema.label.teamId);
  const reachable =
    principal.teamIds.length === 0
      ? workspaceWide
      : or(workspaceWide, inArray(schema.label.teamId, [...principal.teamIds]));
  const clause = and(owned, reachable);
  return clause ?? owned;
}

async function readableLabel(
  executor: Executor,
  principal: Principal,
  labelId: string,
): Promise<LabelRow> {
  const [row] = await executor
    .select()
    .from(schema.label)
    .where(and(eq(schema.label.id, labelId), readableLabels(principal)))
    .limit(1);
  return requireRow(row, MISSING_LABEL);
}

export async function createStarterLabels(
  executor: Executor,
  params: { organizationId: string; syncId: number },
): Promise<LabelRow[]> {
  return await executor
    .insert(schema.label)
    .values(
      STARTER_LABELS.map((entry) => ({
        id: newId(),
        organizationId: params.organizationId,
        teamId: null,
        name: entry.name,
        color: entry.color,
        syncId: params.syncId,
      })),
    )
    .returning();
}

export async function assertLabelsUsable(
  executor: Executor,
  organizationId: string,
  teamId: string,
  labelIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(labelIds)];
  if (wanted.length === 0) return;
  const rows = await executor
    .select({ id: schema.label.id })
    .from(schema.label)
    .where(
      and(
        eq(schema.label.organizationId, organizationId),
        inArray(schema.label.id, wanted),
        or(isNull(schema.label.teamId), eq(schema.label.teamId, teamId)),
      ),
    );
  if (rows.length !== wanted.length) {
    throw validationFailed('Some of those labels are not available on that team.');
  }
}

export async function listLabels(
  principal: Principal,
  options: { teamId?: string } = {},
): Promise<LabelRow[]> {
  assertCan(principal, 'issue:read');
  const rows = await db
    .select()
    .from(schema.label)
    .where(readableLabels(principal))
    .orderBy(asc(schema.label.name));
  if (options.teamId === undefined) return rows;
  return rows.filter((row) => row.teamId === null || row.teamId === options.teamId);
}

export async function getLabel(principal: Principal, labelId: string): Promise<LabelRow> {
  assertCan(principal, 'issue:read');
  return await readableLabel(db, principal, labelId);
}

export async function createLabel(
  principal: Principal,
  input: unknown,
): Promise<{ label: LabelRow; actions: SyncAction[] }> {
  assertCan(principal, 'label:manage');
  const parsed = labelCreateSchema.parse(input);

  return await refusingDuplicates(async () =>
    db.transaction(async (tx) => {
      if (parsed.teamId !== null) await requireTeam(principal, parsed.teamId, tx);
      const syncId = await nextSyncId(tx);
      const actor = await principalActor(tx, principal);
      const [created] = await tx
        .insert(schema.label)
        .values({
          id: newId(),
          organizationId: principal.organizationId,
          teamId: parsed.teamId,
          name: parsed.name,
          color: parsed.color,
          syncId,
        })
        .returning();
      const row = requireRow(created, 'The label could not be created.');
      return {
        label: row,
        actions: [
          buildSyncAction({
            syncId,
            organizationId: principal.organizationId,
            scopes: labelScopes(row),
            action: 'insert',
            model: 'label',
            modelId: row.id,
            data: row,
            actor,
          }),
        ],
      };
    }),
  );
}

export async function updateLabel(
  principal: Principal,
  labelId: string,
  input: unknown,
): Promise<{ label: LabelRow; actions: SyncAction[] }> {
  assertCan(principal, 'label:manage');
  const parsed = labelUpdateSchema.parse(input);

  return await refusingDuplicates(async () =>
    db.transaction(async (tx) => {
      const current = await readableLabel(tx, principal, labelId);
      if (parsed.teamId !== undefined && parsed.teamId !== null) {
        await requireTeam(principal, parsed.teamId, tx);
      }

      const values: Partial<typeof schema.label.$inferInsert> = {};
      if (parsed.name !== undefined) values.name = parsed.name;
      if (parsed.color !== undefined) values.color = parsed.color;
      if (parsed.teamId !== undefined) values.teamId = parsed.teamId;

      const syncId = await nextSyncId(tx);
      const actor = await principalActor(tx, principal);
      const [updated] = await tx
        .update(schema.label)
        .set({ ...values, syncId })
        .where(
          and(
            eq(schema.label.id, current.id),
            eq(schema.label.organizationId, principal.organizationId),
          ),
        )
        .returning();
      const row = requireRow(updated, MISSING_LABEL);
      return {
        label: row,
        actions: [
          buildSyncAction({
            syncId,
            organizationId: principal.organizationId,
            scopes: bothAudiences(current, row),
            action: 'update',
            model: 'label',
            modelId: row.id,
            data: row,
            actor,
          }),
        ],
      };
    }),
  );
}

export async function deleteLabel(principal: Principal, labelId: string): Promise<SyncAction[]> {
  assertCan(principal, 'label:manage');

  return await db.transaction(async (tx) => {
    const row = await readableLabel(tx, principal, labelId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx
      .delete(schema.label)
      .where(
        and(eq(schema.label.id, row.id), eq(schema.label.organizationId, principal.organizationId)),
      );
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: labelScopes(row),
        action: 'delete',
        model: 'label',
        modelId: row.id,
        data: { id: row.id, teamId: row.teamId },
        actor,
      }),
    ];
  });
}
