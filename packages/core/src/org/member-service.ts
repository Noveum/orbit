import { and, asc, count, db, eq, inArray, ne, schema } from '@orbit/db';
import { OPEN_STATE_CATEGORIES, type OrgRole } from '@orbit/shared/constants';
import { conflict, forbidden } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, canAssignRole } from '@orbit/shared/policy';
import { memberUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import type { MemberRow } from './organization-service.ts';

export interface MemberWithUser {
  readonly member: MemberRow;
  readonly user: Pick<
    typeof schema.user.$inferSelect,
    'id' | 'name' | 'email' | 'image' | 'handle'
  >;
}

function isOrgRole(value: string): value is OrgRole {
  return value === 'admin' || value === 'member' || value === 'contributor' || value === 'guest';
}

export async function resolvePrincipal(
  userId: string,
  organizationId: string,
  executor: Executor = db,
): Promise<Principal> {
  const [membership] = await executor
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (membership === undefined) throw forbidden('You are not a member of this workspace.');

  const teams = await executor
    .select({ teamId: schema.teamMember.teamId })
    .from(schema.teamMember)
    .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
    .where(
      and(eq(schema.teamMember.userId, userId), eq(schema.team.organizationId, organizationId)),
    );

  return {
    userId,
    organizationId,
    role: isOrgRole(membership.role) ? membership.role : 'guest',
    teamIds: teams.map((row) => row.teamId),
  };
}

export async function listMembers(principal: Principal): Promise<MemberWithUser[]> {
  const rows = await db
    .select({
      member: schema.member,
      user: {
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        handle: schema.user.handle,
      },
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, principal.organizationId))
    .orderBy(asc(schema.user.name));
  return rows;
}

export async function getMember(principal: Principal, memberId: string): Promise<MemberRow> {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.id, memberId),
        eq(schema.member.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  return requireRow(row, 'That member does not exist.');
}

async function countOtherAdmins(
  executor: Executor,
  organizationId: string,
  excludingMemberId: string,
): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.role, 'admin'),
        ne(schema.member.id, excludingMemberId),
      ),
    );
  return row?.total ?? 0;
}

export async function updateMemberRole(
  principal: Principal,
  memberId: string,
  input: unknown,
): Promise<{ member: MemberRow; actions: SyncAction[] }> {
  assertCan(principal, 'member:manage');
  const parsed = memberUpdateSchema.parse(input);
  if (!canAssignRole(principal.role, parsed.role)) {
    throw forbidden('Only admins can change roles.');
  }

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.id, memberId),
          eq(schema.member.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const current = requireRow(existing, 'That member does not exist.');

    if (current.role === 'admin' && parsed.role !== 'admin') {
      const others = await countOtherAdmins(tx, principal.organizationId, memberId);
      if (others === 0) throw conflict('A workspace needs at least one admin.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.member)
      .set({ role: parsed.role, syncId })
      .where(eq(schema.member.id, memberId))
      .returning();
    const member = requireRow(updated, 'That member does not exist.');

    return {
      member,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.organization(principal.organizationId), scopes.user(member.userId)],
          action: 'update',
          model: 'member',
          modelId: member.id,
          data: member,
          actor,
        }),
      ],
    };
  });
}

export interface RemoveMemberOptions {
  readonly reassignToUserId?: string | null;
}

export async function removeMember(
  principal: Principal,
  memberId: string,
  options: RemoveMemberOptions = {},
): Promise<{ reassignedIssueIds: string[]; actions: SyncAction[] }> {
  assertCan(principal, 'member:manage');

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.id, memberId),
          eq(schema.member.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const current = requireRow(existing, 'That member does not exist.');

    if (current.role === 'admin') {
      const others = await countOtherAdmins(tx, principal.organizationId, memberId);
      if (others === 0) throw conflict('A workspace needs at least one admin.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const nextAssignee = options.reassignToUserId ?? null;

    const openStateIds = tx
      .select({ id: schema.workflowState.id })
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.organizationId, principal.organizationId),
          inArray(schema.workflowState.category, [...OPEN_STATE_CATEGORIES]),
        ),
      );

    const reassigned = await tx
      .update(schema.issue)
      .set({ assigneeId: nextAssignee, updatedAt: new Date(), syncId })
      .where(
        and(
          eq(schema.issue.organizationId, principal.organizationId),
          eq(schema.issue.assigneeId, current.userId),
          inArray(schema.issue.stateId, openStateIds),
        ),
      )
      .returning();

    await tx
      .delete(schema.teamMember)
      .where(
        and(
          eq(schema.teamMember.userId, current.userId),
          inArray(
            schema.teamMember.teamId,
            tx
              .select({ id: schema.team.id })
              .from(schema.team)
              .where(eq(schema.team.organizationId, principal.organizationId)),
          ),
        ),
      );

    await tx.delete(schema.member).where(eq(schema.member.id, memberId));
    await tx.delete(schema.session).where(eq(schema.session.userId, current.userId));

    const actions: SyncAction[] = [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: [scopes.organization(principal.organizationId), scopes.user(current.userId)],
        action: 'delete',
        model: 'member',
        modelId: memberId,
        data: { id: memberId, userId: current.userId },
        actor,
      }),
      ...reassigned.map((row) =>
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [
            scopes.organization(principal.organizationId),
            scopes.team(row.teamId),
            scopes.issue(row.id),
          ],
          action: 'update',
          model: 'issue',
          modelId: row.id,
          data: row,
          actor,
        }),
      ),
    ];

    return { reassignedIssueIds: reassigned.map((row) => row.id), actions };
  });
}
