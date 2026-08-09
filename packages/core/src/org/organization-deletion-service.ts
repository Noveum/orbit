import { and, asc, count, db, desc, eq, gt, isNull, ne, schema, type Transaction } from '@orbit/db';
import {
  type StorageDriver,
  storageDriver,
  storagePrefixFor,
  UPLOAD_COMPLETION_GRACE_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from '@orbit/services/storage';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { conflict } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import {
  type OrganizationDeletionSummary,
  organizationDeleteSchema,
} from '@orbit/shared/validators';
import { type Executor, requireRow } from '../internal.ts';
import { lockOrganization } from './organization-lock.ts';

export type { OrganizationDeletionSummary } from '@orbit/shared/validators';

export interface OrganizationDeletionResult {
  readonly deletedOrganizationId: string;
  readonly deletedOrganizationName: string;
  readonly nextOrganizationId: string | null;
}

interface DeletionProtectionTarget {
  readonly id: string;
  readonly deletionRequestedAt: Date | null;
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

function deletionRequestProtectionEnd(deletionRequestedAt: Date | null): Date | null {
  if (deletionRequestedAt === null) return null;
  const protectionMs = (UPLOAD_URL_TTL_SECONDS + UPLOAD_COMPLETION_GRACE_SECONDS) * 1000;
  return new Date(deletionRequestedAt.getTime() + protectionMs);
}

function laterDate(first: Date | null, second: Date | null): Date | null {
  if (first === null) return second;
  if (second === null) return first;
  return first.getTime() >= second.getTime() ? first : second;
}

async function deletionAvailableAt(
  executor: Executor,
  organization: DeletionProtectionTarget,
  now: Date,
): Promise<Date | null> {
  const trackedUploadEnd = await latestUploadProtectionEnd(executor, organization.id, now);
  const untrackedUploadEnd = deletionRequestProtectionEnd(organization.deletionRequestedAt);
  const availableAt = laterDate(trackedUploadEnd, untrackedUploadEnd);
  if (availableAt === null || availableAt.getTime() <= now.getTime()) return null;
  return availableAt;
}

export async function getOrganizationDeletionSummary(
  principal: Principal,
  driver: StorageDriver = storageDriver(),
  now: Date = new Date(),
): Promise<OrganizationDeletionSummary> {
  assertCan(principal, 'org:delete');
  const [organization] = await db
    .select({
      id: schema.organization.id,
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
      deletionAvailableAt(db, current, now),
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
): Promise<typeof schema.organization.$inferSelect> {
  const organization = await lockOrganization(tx, principal.organizationId);
  await assertCurrentDeletionPermission(tx, principal);
  if (confirmation !== organization.name) {
    throw conflict('Type the current workspace name exactly to confirm deletion.');
  }
  return organization;
}

async function assertDeletionReady(
  tx: Transaction,
  organization: typeof schema.organization.$inferSelect,
  now: Date,
): Promise<void> {
  const availableAt = await deletionAvailableAt(tx, organization, now);
  if (availableAt === null) return;
  throw conflict(
    'Workspace deletion is pending while upload links expire. Retry after this time.',
    {
      details: { availableAt: availableAt.toISOString() },
    },
  );
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
    const organization = await validatedDeletionTarget(tx, principal, parsed.confirmation);
    if (organization.deletionRequestedAt !== null) return;
    await tx
      .update(schema.organization)
      .set({ deletionRequestedAt: now })
      .where(eq(schema.organization.id, organization.id));
  });
  const organizationId = await db.transaction(async (tx) => {
    const organization = await validatedDeletionTarget(tx, principal, parsed.confirmation);
    await assertDeletionReady(tx, organization, now);
    return organization.id;
  });
  await driver.deletePrefix(storagePrefixFor(organizationId));
  return await db.transaction(async (tx) => {
    const organization = await validatedDeletionTarget(tx, principal, parsed.confirmation);
    await assertDeletionReady(tx, organization, now);
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
    return {
      deletedOrganizationId: organization.id,
      deletedOrganizationName: organization.name,
      nextOrganizationId: next?.organizationId ?? null,
    };
  });
}
