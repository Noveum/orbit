import { and, asc, db, eq, gt, inArray, schema } from '@orbit/db';
import { conflict, notFound } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, canAssignRole } from '@orbit/shared/policy';
import { inviteBulkSchema, inviteCreateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { addUtcDays, type Executor, newToken, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type InvitationRow = typeof schema.invitation.$inferSelect;
export type MemberRow = typeof schema.member.$inferSelect;

export const INVITE_TTL_DAYS = 14;

export interface CreatedInvite {
  readonly invitation: InvitationRow;
  readonly token: string;
}

async function assertEmailIsFree(
  executor: Executor,
  organizationId: string,
  email: string,
): Promise<void> {
  const [existing] = await executor
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.user.email, email)))
    .limit(1);
  if (existing !== undefined) throw conflict(`${email} is already a member.`);
}

async function insertInvite(
  executor: Executor,
  params: {
    organizationId: string;
    inviterId: string;
    email: string;
    role: string;
    teamIds: string[];
    now: Date;
  },
): Promise<InvitationRow> {
  await executor
    .delete(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, params.organizationId),
        eq(schema.invitation.email, params.email),
        eq(schema.invitation.status, 'pending'),
      ),
    );
  const [row] = await executor
    .insert(schema.invitation)
    .values({
      id: newToken(),
      organizationId: params.organizationId,
      email: params.email,
      role: params.role,
      status: 'pending',
      teamIds: params.teamIds,
      inviterId: params.inviterId,
      expiresAt: addUtcDays(params.now, INVITE_TTL_DAYS),
    })
    .returning();
  return requireRow(row, 'The invite could not be created.');
}

function inviteAction(
  invitation: InvitationRow,
  syncId: number,
  actor: Parameters<typeof buildSyncAction>[0]['actor'],
  action: 'insert' | 'update' | 'delete',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: invitation.organizationId,
    scopes: [scopes.organization(invitation.organizationId)],
    action,
    model: 'member',
    modelId: invitation.id,
    data: { ...invitation, kind: 'invitation' },
    actor,
  });
}

export async function createInvite(
  principal: Principal,
  input: unknown,
): Promise<{ invitation: InvitationRow; token: string; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');
  const parsed = inviteCreateSchema.parse(input);
  if (!canAssignRole(principal.role, parsed.role) && parsed.role === 'admin') {
    throw conflict('Only admins can invite admins.');
  }

  return await db.transaction(async (tx) => {
    await assertEmailIsFree(tx, principal.organizationId, parsed.email);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const invitation = await insertInvite(tx, {
      organizationId: principal.organizationId,
      inviterId: principal.userId,
      email: parsed.email,
      role: parsed.role,
      teamIds: parsed.teamIds,
      now: new Date(),
    });
    return {
      invitation,
      token: invitation.id,
      actions: [inviteAction(invitation, syncId, actor, 'insert')],
    };
  });
}

export async function createInvites(
  principal: Principal,
  input: unknown,
): Promise<{ invites: CreatedInvite[]; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');
  const parsed = inviteBulkSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const now = new Date();
    const invites: CreatedInvite[] = [];
    const actions: SyncAction[] = [];
    for (const entry of parsed.invites) {
      await assertEmailIsFree(tx, principal.organizationId, entry.email);
      const invitation = await insertInvite(tx, {
        organizationId: principal.organizationId,
        inviterId: principal.userId,
        email: entry.email,
        role: entry.role,
        teamIds: entry.teamIds,
        now,
      });
      invites.push({ invitation, token: invitation.id });
      actions.push(inviteAction(invitation, syncId, actor, 'insert'));
    }
    return { invites, actions };
  });
}

export async function listPendingInvites(principal: Principal): Promise<InvitationRow[]> {
  assertCan(principal, 'member:invite');
  return await db
    .select()
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, principal.organizationId),
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.invitation.createdAt));
}

export async function revokeInvite(
  principal: Principal,
  inviteId: string,
): Promise<{ invitation: InvitationRow; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.invitation)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(schema.invitation.id, inviteId),
          eq(schema.invitation.organizationId, principal.organizationId),
          eq(schema.invitation.status, 'pending'),
        ),
      )
      .returning();
    const invitation = requireRow(updated, 'That invite is no longer pending.');
    return { invitation, actions: [inviteAction(invitation, syncId, actor, 'delete')] };
  });
}

export async function resendInvite(
  principal: Principal,
  inviteId: string,
): Promise<{ invitation: InvitationRow; token: string; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.invitation)
      .set({ expiresAt: addUtcDays(new Date(), INVITE_TTL_DAYS), status: 'pending' })
      .where(
        and(
          eq(schema.invitation.id, inviteId),
          eq(schema.invitation.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const invitation = requireRow(updated, 'That invite does not exist.');
    return {
      invitation,
      token: invitation.id,
      actions: [inviteAction(invitation, syncId, actor, 'update')],
    };
  });
}

export interface AcceptedInvite {
  readonly member: MemberRow;
  readonly organizationId: string;
  readonly teamIds: string[];
  readonly alreadyAccepted: boolean;
  readonly actions: SyncAction[];
}

export async function acceptInvite(token: string, userId: string): Promise<AcceptedInvite> {
  return await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.id, token))
      .limit(1);
    const invitation = requireRow(found, 'That invite is not valid.');

    const [existingMember] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, invitation.organizationId),
          eq(schema.member.userId, userId),
        ),
      )
      .limit(1);

    if (existingMember !== undefined) {
      return {
        member: existingMember,
        organizationId: invitation.organizationId,
        teamIds: invitation.teamIds,
        alreadyAccepted: true,
        actions: [],
      };
    }

    if (invitation.status !== 'pending') throw conflict('That invite is no longer available.');
    if (invitation.expiresAt.getTime() < Date.now()) throw conflict('That invite has expired.');

    const [invitedUser] = await tx
      .select({ email: schema.user.email, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (invitedUser === undefined) throw notFound('That account does not exist.');
    if (invitedUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw conflict('That invite was sent to a different email address.');
    }

    const syncId = await nextSyncId(tx);
    const [created] = await tx
      .insert(schema.member)
      .values({
        id: newToken().slice(0, 32),
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        syncId,
      })
      .returning();
    const member = requireRow(created, 'The membership could not be created.');

    const teamIds =
      invitation.teamIds.length === 0
        ? []
        : (
            await tx
              .select({ id: schema.team.id })
              .from(schema.team)
              .where(
                and(
                  eq(schema.team.organizationId, invitation.organizationId),
                  inArray(schema.team.id, invitation.teamIds),
                ),
              )
          ).map((row) => row.id);

    if (teamIds.length > 0) {
      await tx
        .insert(schema.teamMember)
        .values(teamIds.map((teamId) => ({ id: newToken().slice(0, 32), teamId, userId })))
        .onConflictDoNothing();
    }

    await tx
      .update(schema.invitation)
      .set({ status: 'accepted' })
      .where(eq(schema.invitation.id, invitation.id));

    const actor = { type: 'user', id: userId, name: invitedUser.name } as const;

    return {
      member,
      organizationId: invitation.organizationId,
      teamIds,
      alreadyAccepted: false,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: invitation.organizationId,
          scopes: [
            scopes.organization(invitation.organizationId),
            scopes.user(userId),
            ...teamIds.map((teamId) => scopes.team(teamId)),
          ],
          action: 'insert',
          model: 'member',
          modelId: member.id,
          data: member,
          actor,
        }),
      ],
    };
  });
}

export { matchAllowedDomain } from './organization-service.ts';
