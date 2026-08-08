import { and, asc, count, db, desc, eq, gt, ne, schema } from '@orbit/db';
import { type StorageDriver, storageDriver, storagePrefixFor } from '@orbit/services/storage';
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
}

export interface OrganizationDeletionResult {
  readonly deletedOrganizationId: string;
  readonly deletedOrganizationName: string;
  readonly nextOrganizationId: string | null;
}

function totalOf(rows: readonly { readonly total: number }[]): number {
  return rows[0]?.total ?? 0;
}

async function latestLiveUploadExpiration(
  executor: Executor,
  organizationId: string,
  now: Date,
): Promise<Date | null> {
  const [row] = await executor
    .select({ uploadExpiresAt: schema.attachment.uploadExpiresAt })
    .from(schema.attachment)
    .where(
      and(
        eq(schema.attachment.organizationId, organizationId),
        gt(schema.attachment.uploadExpiresAt, now),
      ),
    )
    .orderBy(desc(schema.attachment.uploadExpiresAt))
    .limit(1);
  return row?.uploadExpiresAt ?? null;
}

export async function getOrganizationDeletionSummary(
  principal: Principal,
  driver: StorageDriver = storageDriver(),
  now: Date = new Date(),
): Promise<OrganizationDeletionSummary> {
  assertCan(principal, 'org:delete');
  const [organization] = await db
    .select({ name: schema.organization.name })
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
      latestLiveUploadExpiration(db, principal.organizationId, now),
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
  };
}

export async function deleteOrganization(
  principal: Principal,
  input: unknown,
  driver: StorageDriver = storageDriver(),
  now: Date = new Date(),
): Promise<OrganizationDeletionResult> {
  assertCan(principal, 'org:delete');
  const parsed = organizationDeleteSchema.parse(input);
  return await db.transaction(async (tx) => {
    const organization = await lockOrganization(tx, principal.organizationId);
    if (parsed.confirmation !== organization.name) {
      throw conflict('Type the current workspace name exactly to confirm deletion.');
    }
    const availableAt = await latestLiveUploadExpiration(tx, organization.id, now);
    if (availableAt !== null) {
      throw conflict('Wait for pending upload links to expire before deleting this workspace.', {
        details: { availableAt: availableAt.toISOString() },
      });
    }
    await driver.deletePrefix(storagePrefixFor(organization.id));
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
