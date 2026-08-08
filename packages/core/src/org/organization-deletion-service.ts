import { and, asc, count, db, desc, eq, gt, isNull, ne, schema, type Transaction } from '@orbit/db';
import {
  type StorageDriver,
  storageDriver,
  storagePrefixFor,
  UPLOAD_COMPLETION_GRACE_SECONDS,
} from '@orbit/services/storage';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { conflict } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { organizationDeleteSchema } from '@orbit/shared/validators';
import { type Executor, requireRow } from '../internal.ts';
import { lockOrganization } from './organization-lock.ts';

export interface OrganizationDeletionSummary {
  readonly organizationName: string;
  readonly members: number;
  readonly teams: number;
  readonly projects: number;
  readonly issues: number;
  readonly documents: number;
  readonly files: number;
  readonly fileBytes: number;
  readonly fileVersions: number;
  readonly fileVersionBytes: number;
  readonly integrations: number;
  readonly webhooks: number;
  readonly availableAt: string | null;
  readonly deletionRequestedAt: string | null;
}

export interface OrganizationDeletionResult {
  readonly deletedOrganizationId: string;
  readonly deletedOrganizationName: string;
  readonly nextOrganizationId: string | null;
}

function totalOf(rows: readonly { readonly total: number }[]): number {
  return rows[0]?.total ?? 0;
}

function organizationRole(value: string | undefined): OrgRole {
  return ORG_ROLES.find((role) => role === value) ?? 'guest';
}

async function assertCurrentDeletionPermission(
  tx: Transaction,
  principal: Principal,
): Promise<void> {
  const [membership] = await tx
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
      ),
    )
    .limit(1)
    .for('update');
  assertCan({ ...principal, role: organizationRole(membership?.role) }, 'org:delete');
}

async function latestUploadProtectionEnd(
  executor: Executor,
  organizationId: string,
  now: Date,
): Promise<Date | null> {
  const graceMs = UPLOAD_COMPLETION_GRACE_SECONDS * 1000;
  const protectedAfter = new Date(now.getTime() - graceMs);
  const [row] = await executor
    .select({ uploadExpiresAt: schema.attachment.uploadExpiresAt })
    .from(schema.attachment)
    .where(
      and(
        eq(schema.attachment.organizationId, organizationId),
        gt(schema.attachment.uploadExpiresAt, protectedAfter),
      ),
    )
    .orderBy(desc(schema.attachment.uploadExpiresAt))
    .limit(1);
  const expiration = row?.uploadExpiresAt;
  if (expiration === undefined || expiration === null) return null;
  return new Date(expiration.getTime() + graceMs);
}

export async function getOrganizationDeletionSummary(
  principal: Principal,
  driver: StorageDriver = storageDriver(),
  now: Date = new Date(),
): Promise<OrganizationDeletionSummary> {
  assertCan(principal, 'org:delete');
  const [organization] = await db
    .select({
      name: schema.organization.name,
      deletionRequestedAt: schema.organization.deletionRequestedAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, principal.organizationId))
    .limit(1);
  const current = requireRow(organization, 'That workspace does not exist.');
  const [members, teams, projects, issues, documents, integrations, webhooks, availableAt, stored] =
    await Promise.all([
      db
        .select({ total: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, principal.organizationId)),
      db
        .select({ total: count() })
        .from(schema.team)
        .where(eq(schema.team.organizationId, principal.organizationId)),
      db
        .select({ total: count() })
        .from(schema.project)
        .where(eq(schema.project.organizationId, principal.organizationId)),
      db
        .select({ total: count() })
        .from(schema.issue)
        .where(eq(schema.issue.organizationId, principal.organizationId)),
      db
        .select({ total: count() })
        .from(schema.doc)
        .where(eq(schema.doc.organizationId, principal.organizationId)),
      db
        .select({ total: count() })
        .from(schema.integration)
        .where(eq(schema.integration.organizationId, principal.organizationId)),
      db
        .select({ total: count() })
        .from(schema.webhook)
        .where(eq(schema.webhook.organizationId, principal.organizationId)),
      latestUploadProtectionEnd(db, principal.organizationId, now),
      driver.summarizePrefix(storagePrefixFor(principal.organizationId)),
    ]);
  return {
    organizationName: current.name,
    members: totalOf(members),
    teams: totalOf(teams),
    projects: totalOf(projects),
    issues: totalOf(issues),
    documents: totalOf(documents),
    files: stored.objects,
    fileBytes: stored.bytes,
    fileVersions: stored.versions,
    fileVersionBytes: stored.versionBytes,
    integrations: totalOf(integrations),
    webhooks: totalOf(webhooks),
    availableAt: availableAt?.toISOString() ?? null,
    deletionRequestedAt: current.deletionRequestedAt?.toISOString() ?? null,
  };
}

async function validatedDeletionTarget(
  tx: Transaction,
  principal: Principal,
  confirmation: string,
  now: Date,
): Promise<typeof schema.organization.$inferSelect> {
  const organization = await lockOrganization(tx, principal.organizationId);
  await assertCurrentDeletionPermission(tx, principal);
  if (confirmation !== organization.name) {
    throw conflict('Type the current workspace name exactly to confirm deletion.');
  }
  const availableAt = await latestUploadProtectionEnd(tx, organization.id, now);
  if (availableAt !== null) {
    throw conflict('Wait for pending upload links to expire before deleting this workspace.', {
      details: { availableAt: availableAt.toISOString() },
    });
  }
  return organization;
}

export async function deleteOrganization(
  principal: Principal,
  input: unknown,
  driver: StorageDriver = storageDriver(),
  now: Date = new Date(),
): Promise<OrganizationDeletionResult> {
  assertCan(principal, 'org:delete');
  const parsed = organizationDeleteSchema.parse(input);
  await db.transaction(async (tx) => {
    const organization = await validatedDeletionTarget(tx, principal, parsed.confirmation, now);
    if (organization.deletionRequestedAt !== null) return;
    await tx
      .update(schema.organization)
      .set({ deletionRequestedAt: now })
      .where(eq(schema.organization.id, organization.id));
  });
  return await db.transaction(async (tx) => {
    const organization = await validatedDeletionTarget(tx, principal, parsed.confirmation, now);
    await tx
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(eq(schema.session.activeOrganizationId, organization.id));
    const [next] = await tx
      .select({ organizationId: schema.organization.id })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(
        and(
          eq(schema.member.userId, principal.userId),
          ne(schema.member.organizationId, organization.id),
          isNull(schema.organization.deletionRequestedAt),
        ),
      )
      .orderBy(asc(schema.organization.name), asc(schema.organization.id))
      .limit(1);
    await tx.delete(schema.organization).where(eq(schema.organization.id, organization.id));
    await driver.deletePrefix(storagePrefixFor(organization.id));
    return {
      deletedOrganizationId: organization.id,
      deletedOrganizationName: organization.name,
      nextOrganizationId: next?.organizationId ?? null,
    };
  });
}
