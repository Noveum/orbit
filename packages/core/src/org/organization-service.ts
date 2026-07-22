import { and, asc, db, eq, schema } from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { organizationCreateSchema, organizationUpdateSchema } from '@orbit/shared/validators';
import { newId, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { createStarterLabels, type LabelRow } from '../work/label-service.ts';
import { bootstrapTeam, deriveTeamKey, type TeamBootstrap } from './team-service.ts';

export type OrganizationRow = typeof schema.organization.$inferSelect;
export type MemberRow = typeof schema.member.$inferSelect;

export interface OrganizationBootstrap {
  readonly organization: OrganizationRow;
  readonly member: MemberRow;
  readonly team: TeamBootstrap['team'];
  readonly states: TeamBootstrap['states'];
  readonly labels: LabelRow[];
  readonly actions: SyncAction[];
}

export async function createOrganization(
  userId: string,
  input: unknown,
): Promise<OrganizationBootstrap> {
  const parsed = organizationCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, parsed.slug))
      .limit(1);
    if (taken !== undefined) throw conflict('That workspace address is already taken.');

    const syncId = await nextSyncId(tx);
    const [createdOrg] = await tx
      .insert(schema.organization)
      .values({ id: newId(), name: parsed.name, slug: parsed.slug })
      .returning();
    const organization = requireRow(createdOrg, 'The workspace could not be created.');

    const [createdMember] = await tx
      .insert(schema.member)
      .values({
        id: newId(),
        organizationId: organization.id,
        userId,
        role: 'admin',
        syncId,
      })
      .returning();
    const member = requireRow(createdMember, 'The owner membership could not be created.');

    const bootstrap = await bootstrapTeam(tx, {
      organizationId: organization.id,
      creatorId: userId,
      name: parsed.name,
      key: deriveTeamKey(parsed.name),
      syncId,
    });
    const labels = await createStarterLabels(tx, { organizationId: organization.id, syncId });

    const [creator] = await tx
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    const actor = { type: 'user', id: userId, name: creator?.name ?? 'Someone' } as const;

    return {
      organization,
      member,
      team: bootstrap.team,
      states: bootstrap.states,
      labels,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: organization.id,
          scopes: [scopes.organization(organization.id), scopes.user(userId)],
          action: 'insert',
          model: 'member',
          modelId: member.id,
          data: { ...member, organization },
          actor,
        }),
        buildSyncAction({
          syncId,
          organizationId: organization.id,
          scopes: [scopes.organization(organization.id), scopes.team(bootstrap.team.id)],
          action: 'insert',
          model: 'team',
          modelId: bootstrap.team.id,
          data: bootstrap.team,
          actor,
        }),
      ],
    };
  });
}

export async function updateOrganization(
  principal: Principal,
  input: unknown,
): Promise<{ organization: OrganizationRow; actions: SyncAction[] }> {
  assertCan(principal, 'org:manage');
  const parsed = organizationUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.organization.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.logo !== undefined) values.logo = parsed.logo;
    if (parsed.allowedEmailDomains !== undefined) {
      values.allowedEmailDomains = parsed.allowedEmailDomains;
    }

    const syncId = await nextSyncId(tx);
    const [updated] = await tx
      .update(schema.organization)
      .set({ ...values, syncId })
      .where(eq(schema.organization.id, principal.organizationId))
      .returning();
    const organization = requireRow(updated, 'That workspace does not exist.');

    const [actorRow] = await tx
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, principal.userId))
      .limit(1);

    return {
      organization,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: organization.id,
          scopes: [scopes.organization(organization.id)],
          action: 'update',
          model: 'organization',
          modelId: organization.id,
          data: organization,
          actor: { type: 'user', id: principal.userId, name: actorRow?.name ?? 'Someone' },
        }),
      ],
    };
  });
}

export async function getOrganizationBySlug(slug: string): Promise<OrganizationRow> {
  const [row] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  return requireRow(row, 'That workspace does not exist.');
}

export async function getOrganization(organizationId: string): Promise<OrganizationRow> {
  const [row] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return requireRow(row, 'That workspace does not exist.');
}

export async function listOrganizationsForUser(
  userId: string,
): Promise<{ organization: OrganizationRow; role: string }[]> {
  const rows = await db
    .select({ organization: schema.organization, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.organization.name));
  return rows;
}

export function matchAllowedDomain(
  organization: Pick<OrganizationRow, 'allowedEmailDomains'>,
  email: string,
): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const allowed = organization.allowedEmailDomains.map((entry) =>
    entry.trim().toLowerCase().replace(/^@/, ''),
  );
  return allowed.includes(domain) ? domain : null;
}

export async function findOrganizationsForEmailDomain(email: string): Promise<OrganizationRow[]> {
  const rows = await db.select().from(schema.organization);
  return rows.filter((row) => matchAllowedDomain(row, email) !== null);
}

export async function getMembership(
  organizationId: string,
  userId: string,
): Promise<MemberRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  return row;
}
