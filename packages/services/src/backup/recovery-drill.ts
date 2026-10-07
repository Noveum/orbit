import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeRestoreTargetIdentity, validationFailed } from '@orbit/shared';
import Redis from 'ioredis';
import postgres from 'postgres';
import { storageDriver } from '../storage/index.ts';
import type { StorageDriver } from '../storage/types.ts';
import { createBackup } from './create.ts';
import { restoreBackup } from './restore.ts';
import type {
  RecoveryDrillAttachmentRecord,
  RecoveryDrillMetrics,
  RecoveryDrillOptions,
  RecoveryDrillRepresentativeData,
  RecoveryDrillResult,
} from './types.ts';

const REDIS_DELTA_CHANNEL = 'orbit:delta';

function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function seedDrillRepresentativeData(
  sql: postgres.Sql,
  driver: StorageDriver,
): Promise<RecoveryDrillRepresentativeData> {
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `drill-org-${suffix}`;
  const adminUserId = `drill-usr-admin-${suffix}`;
  const memberUserId = `drill-usr-member-${suffix}`;
  const revokedUserId = `drill-usr-revoked-${suffix}`;
  const teamId = `drill-team-${suffix}`;
  const projectId = `drill-proj-${suffix}`;
  const milestoneId = `drill-mstone-${suffix}`;
  const stateId = `drill-state-${suffix}`;
  const issueId = `drill-issue-${suffix}`;
  const commentId = `drill-comment-${suffix}`;
  const docId = `drill-doc-${suffix}`;
  const clientId = `drill-mcp-client-${suffix}`;
  const activeGrantId = `drill-grant-active-${suffix}`;
  const revokedGrantId = `drill-grant-revoked-${suffix}`;

  await sql`
    insert into public.organization (id, name, slug, sync_id)
    values (${organizationId}, ${`Drill Org ${suffix}`}, ${organizationId}, 1)
  `;

  await sql`
    insert into public."user" (id, name, email, handle, email_verified, onboarding_step)
    values
      (${adminUserId}, 'Drill Admin', ${`drill-admin-${suffix}@example.com`}, ${`drilladmin${suffix}`}, true, 'completed'),
      (${memberUserId}, 'Drill Member', ${`drill-member-${suffix}@example.com`}, ${`drillmember${suffix}`}, true, 'completed'),
      (${revokedUserId}, 'Drill Revoked', ${`drill-revoked-${suffix}@example.com`}, ${`drillrevoked${suffix}`}, true, 'completed')
  `;

  await sql`
    insert into public.account (id, account_id, provider_id, user_id)
    values
      (${randomUUID()}, ${adminUserId}, 'credential', ${adminUserId}),
      (${randomUUID()}, ${memberUserId}, 'credential', ${memberUserId}),
      (${randomUUID()}, ${revokedUserId}, 'credential', ${revokedUserId})
  `;

  const futureExpiry = new Date(Date.now() + 86400000);
  const pastExpiry = new Date(Date.now() - 86400000);

  await sql`
    insert into public.session (id, token, user_id, expires_at)
    values
      (${randomUUID()}, ${`tok-admin-${suffix}`}, ${adminUserId}, ${futureExpiry}),
      (${randomUUID()}, ${`tok-member-${suffix}`}, ${memberUserId}, ${futureExpiry}),
      (${randomUUID()}, ${`tok-revoked-${suffix}`}, ${revokedUserId}, ${pastExpiry})
  `;

  await sql`
    insert into public.member (id, organization_id, user_id, role)
    values
      (${randomUUID()}, ${organizationId}, ${adminUserId}, 'admin'),
      (${randomUUID()}, ${organizationId}, ${memberUserId}, 'member')
  `;

  await sql`
    insert into public.team (id, organization_id, name, key)
    values (${teamId}, ${organizationId}, 'Platform Engineering', 'ENG')
  `;

  await sql`
    insert into public.team_member (id, team_id, user_id)
    values
      (${randomUUID()}, ${teamId}, ${adminUserId}),
      (${randomUUID()}, ${teamId}, ${memberUserId})
  `;

  await sql`
    insert into public.workflow_state (id, organization_id, team_id, name, category, color, position)
    values (${stateId}, ${organizationId}, ${teamId}, 'In Progress', 'started', '#3B82F6', 0)
  `;

  await sql`
    insert into public.project (id, organization_id, name, slug, health)
    values (${projectId}, ${organizationId}, 'Disaster Recovery Verification', ${`dr-project-${suffix}`}, 'on_track')
  `;

  await sql`
    insert into public.milestone (id, organization_id, project_id, name)
    values (${milestoneId}, ${organizationId}, ${projectId}, 'Phase 1 Durability')
  `;

  await sql`
    insert into public.issue (id, organization_id, team_id, number, identifier, title, state_id, project_id, creator_id)
    values (${issueId}, ${organizationId}, ${teamId}, 1, 'ENG-1', 'Validate Continuous Backup and Restore Drill', ${stateId}, ${projectId}, ${adminUserId})
  `;

  await sql`
    insert into public.comment (id, organization_id, issue_id, author_id, body)
    values (${commentId}, ${organizationId}, ${issueId}, ${adminUserId}, 'Proving backup durability and byte-for-byte attachment recovery.')
  `;

  await sql`
    insert into public.doc (id, organization_id, title, author_id, content)
    values (${docId}, ${organizationId}, 'Recovery Architecture Spec', ${adminUserId}, '# Disaster Recovery Architecture\n\nAll state and attachments must survive byte-for-byte.')
  `;

  const oauthApplicationId = randomUUID();
  await sql`
    insert into public.oauth_application (id, name, client_id, redirect_urls, type)
    values (${oauthApplicationId}, 'Drill MCP Toolset', ${clientId}, 'https://orbit.local/oauth/callback', 'web')
  `;

  await sql`
    insert into public.mcp_grant (id, client_id, user_id, organization_id, scopes, revoked_at)
    values
      (${activeGrantId}, ${clientId}, ${adminUserId}, ${organizationId}, 'orbit.read,orbit.write', null),
      (${revokedGrantId}, ${clientId}, ${memberUserId}, ${organizationId}, 'orbit.read', ${new Date()})
  `;

  const attachment1Buffer = Buffer.from(
    `Orbit recovery verification plain payload text: ${suffix}`,
    'utf8',
  );
  const attachment1Key = `${organizationId}/issue/${issueId}/text-spec-${suffix}.txt`;
  await driver.put(attachment1Key, attachment1Buffer, 'text/plain');

  const attachment2Buffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  ]);
  const attachment2Key = `${organizationId}/issue/${issueId}/binary-token-${suffix}.png`;
  await driver.put(attachment2Key, attachment2Buffer, 'image/png');

  const attachment1Id = randomUUID();
  const attachment2Id = randomUUID();

  await sql`
    insert into public.attachment (id, organization_id, parent_type, parent_id, file_name, content_type, size, storage_key, uploaded_by_id, status)
    values
      (${attachment1Id}, ${organizationId}, 'issue', ${issueId}, 'text-spec.txt', 'text/plain', ${attachment1Buffer.length}, ${attachment1Key}, ${adminUserId}, 'ready'),
      (${attachment2Id}, ${organizationId}, 'issue', ${issueId}, 'binary-token.png', 'image/png', ${attachment2Buffer.length}, ${attachment2Key}, ${adminUserId}, 'ready')
  `;

  const attachments: RecoveryDrillAttachmentRecord[] = [
    {
      id: attachment1Id,
      storageKey: attachment1Key,
      fileName: 'text-spec.txt',
      contentType: 'text/plain',
      bytes: attachment1Buffer.length,
      sha256: sha256Buffer(attachment1Buffer),
      content: attachment1Buffer,
    },
    {
      id: attachment2Id,
      storageKey: attachment2Key,
      fileName: 'binary-token.png',
      contentType: 'image/png',
      bytes: attachment2Buffer.length,
      sha256: sha256Buffer(attachment2Buffer),
      content: attachment2Buffer,
    },
  ];

  return {
    organizationId,
    adminUserId,
    memberUserId,
    revokedUserId,
    teamId,
    projectId,
    issueId,
    commentId,
    docId,
    activeGrantId,
    revokedGrantId,
    oauthApplicationId,
    attachments,
  };
}

async function verifyEntityRows(
  sql: postgres.Sql,
  expected: RecoveryDrillRepresentativeData,
  errors: string[],
): Promise<void> {
  const [orgRow] = await sql<{ id: string }[]>`
    select id from public.organization where id = ${expected.organizationId}
  `;
  if (orgRow === undefined) {
    errors.push(`Organization ${expected.organizationId} was not restored.`);
  }

  const [issueRow] = await sql<{ id: string; title: string }[]>`
    select id, title from public.issue where id = ${expected.issueId}
  `;
  if (issueRow === undefined) {
    errors.push(`Issue ${expected.issueId} was not restored.`);
  }

  const [commentRow] = await sql<{ id: string }[]>`
    select id from public.comment where id = ${expected.commentId}
  `;
  if (commentRow === undefined) {
    errors.push(`Comment ${expected.commentId} was not restored.`);
  }

  const [docRow] = await sql<{ id: string }[]>`
    select id from public.doc where id = ${expected.docId}
  `;
  if (docRow === undefined) {
    errors.push(`Doc ${expected.docId} was not restored.`);
  }

  const [activeGrantRow] = await sql<{ id: string; revoked_at: Date | null }[]>`
    select id, revoked_at from public.mcp_grant where id = ${expected.activeGrantId}
  `;
  if (activeGrantRow === undefined) {
    errors.push(`Active MCP grant ${expected.activeGrantId} was not restored.`);
  } else if (activeGrantRow.revoked_at !== null) {
    errors.push(`Active MCP grant ${expected.activeGrantId} was unexpectedly marked revoked.`);
  }

  const [revokedGrantRow] = await sql<{ id: string; revoked_at: Date | null }[]>`
    select id, revoked_at from public.mcp_grant where id = ${expected.revokedGrantId}
  `;
  if (revokedGrantRow === undefined) {
    errors.push(`Revoked MCP grant ${expected.revokedGrantId} was not restored.`);
  } else if (revokedGrantRow.revoked_at === null) {
    errors.push(`Revoked MCP grant ${expected.revokedGrantId} did not retain its revoked status.`);
  }

  const [adminMemberRow] = await sql<{ role: string }[]>`
    select role from public.member
    where organization_id = ${expected.organizationId} and user_id = ${expected.adminUserId}
  `;
  if (adminMemberRow?.role !== 'admin') {
    errors.push(`Admin member role was not restored as admin.`);
  }

  const [memberMemberRow] = await sql<{ role: string }[]>`
    select role from public.member
    where organization_id = ${expected.organizationId} and user_id = ${expected.memberUserId}
  `;
  if (memberMemberRow?.role !== 'member') {
    errors.push(`Standard member role was not restored as member.`);
  }
}

async function verifyAttachmentRows(
  driver: StorageDriver,
  attachments: readonly RecoveryDrillAttachmentRecord[],
  errors: string[],
): Promise<void> {
  for (const expectedAtt of attachments) {
    const rawData = await driver.get(expectedAtt.storageKey);
    if (rawData === null) {
      errors.push(`Attachment object ${expectedAtt.storageKey} is missing in storage driver.`);
      continue;
    }
    const retrievedBuffer = Buffer.from(rawData);
    if (retrievedBuffer.length !== expectedAtt.bytes) {
      errors.push(
        `Attachment ${expectedAtt.storageKey} size mismatch: expected ${expectedAtt.bytes}, got ${retrievedBuffer.length}.`,
      );
    }
    const actualHash = sha256Buffer(retrievedBuffer);
    if (actualHash !== expectedAtt.sha256) {
      errors.push(
        `Attachment ${expectedAtt.storageKey} SHA-256 mismatch: expected ${expectedAtt.sha256}, got ${actualHash}.`,
      );
    }
    if (Buffer.compare(retrievedBuffer, expectedAtt.content) !== 0) {
      errors.push(`Attachment ${expectedAtt.storageKey} binary content differs byte-for-byte.`);
    }
  }
}

export async function verifyDrillRepresentativeData(
  sql: postgres.Sql,
  driver: StorageDriver,
  expected: RecoveryDrillRepresentativeData,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  await verifyEntityRows(sql, expected, errors);
  await verifyAttachmentRows(driver, expected.attachments, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function verifyRedisRealtimeAfterEmpty(
  redisUrl: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  let subClient: Redis | undefined;
  let pubClient: Redis | undefined;

  try {
    subClient = new Redis(redisUrl, {
      connectTimeout: 3000,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    pubClient = new Redis(redisUrl, {
      connectTimeout: 3000,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });

    subClient.on('error', () => undefined);
    pubClient.on('error', () => undefined);

    await subClient.connect();
    await pubClient.connect();

    const dbsize = await pubClient.dbsize();
    if (dbsize > 0) {
      errors.push(`Redis was expected to start empty, but contained ${dbsize} keys.`);
    }

    const testPayload = JSON.stringify({
      type: 'drill_verification',
      timestamp: Date.now(),
      id: randomUUID(),
    });

    const receivedMessagePromise = new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 3000);
      subClient?.on('message', (channel, message) => {
        if (channel === REDIS_DELTA_CHANNEL) {
          clearTimeout(timeout);
          resolve(message);
        }
      });
    });

    await subClient.subscribe(REDIS_DELTA_CHANNEL);
    await new Promise((r) => setTimeout(r, 50));
    await pubClient.publish(REDIS_DELTA_CHANNEL, testPayload);

    const received = await receivedMessagePromise;
    if (received !== testPayload) {
      errors.push(
        'Redis realtime pub/sub message was not received across clients after empty start.',
      );
    }
  } catch (err) {
    errors.push(`Redis empty realtime check failed: ${String(err)}`);
  } finally {
    if (subClient !== undefined) {
      await subClient.quit().catch(() => subClient?.disconnect());
    }
    if (pubClient !== undefined) {
      await pubClient.quit().catch(() => pubClient?.disconnect());
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function isRelationMissingError(error: unknown): boolean {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === '42P01') {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('does not exist');
}

async function wipeDatabaseAndStorage(
  sql: postgres.Sql,
  driver: StorageDriver,
  data: RecoveryDrillRepresentativeData,
  redisUrl: string | undefined,
  skipRedisCheck: boolean | undefined,
): Promise<void> {
  const deletes = [
    sql`delete from public.mcp_grant where id in (${data.activeGrantId}, ${data.revokedGrantId})`,
    data.oauthApplicationId === undefined
      ? undefined
      : sql`delete from public.oauth_application where id = ${data.oauthApplicationId}`,
    sql`delete from public.attachment where organization_id = ${data.organizationId}`,
    sql`delete from public.comment where id = ${data.commentId}`,
    sql`delete from public.issue where id = ${data.issueId}`,
    sql`delete from public.doc where id = ${data.docId}`,
    sql`delete from public.milestone where organization_id = ${data.organizationId}`,
    sql`delete from public.project where id = ${data.projectId}`,
    sql`delete from public.workflow_state where organization_id = ${data.organizationId}`,
    sql`delete from public.team_member where team_id = ${data.teamId}`,
    sql`delete from public.team where id = ${data.teamId}`,
    sql`delete from public.member where organization_id = ${data.organizationId}`,
    sql`delete from public.organization where id = ${data.organizationId}`,
    sql`delete from public.session where user_id in (${data.adminUserId}, ${data.memberUserId}, ${data.revokedUserId})`,
    sql`delete from public.account where user_id in (${data.adminUserId}, ${data.memberUserId}, ${data.revokedUserId})`,
    sql`delete from public."user" where id in (${data.adminUserId}, ${data.memberUserId}, ${data.revokedUserId})`,
  ];

  for (const del of deletes) {
    if (del === undefined) continue;
    try {
      await del;
    } catch (error) {
      if (!isRelationMissingError(error)) {
        throw error;
      }
    }
  }

  for (const att of data.attachments) {
    await driver.delete(att.storageKey).catch(() => undefined);
  }

  if (redisUrl !== undefined && redisUrl.length > 0 && skipRedisCheck !== true) {
    try {
      const redis = new Redis(redisUrl, {
        connectTimeout: 2000,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      redis.on('error', () => undefined);
      await redis.connect();
      await redis.flushdb();
      await redis.quit().catch(() => redis.disconnect());
    } catch {
      return;
    }
  }
}

async function computeDirectorySizeBytes(dirPath: string): Promise<number> {
  let totalBytes = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalBytes += await computeDirectorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        const fileStat = await stat(fullPath);
        totalBytes += fileStat.size;
      }
    }
  } catch {
    return totalBytes;
  }
  return totalBytes;
}

export async function runRecoveryDrill(
  options: RecoveryDrillOptions,
): Promise<RecoveryDrillResult> {
  const databaseUrl = options.databaseUrl;
  if (databaseUrl.length === 0) {
    throw validationFailed('Target database connection URL is required for recovery drill.');
  }

  const bucket = process.env['S3_BUCKET'];
  const target = computeRestoreTargetIdentity(databaseUrl, bucket);
  if (options.confirmDestructiveTarget !== target.identity) {
    throw validationFailed(
      `Recovery drill refused: confirmDestructiveTarget "${options.confirmDestructiveTarget ?? ''}" does not match target identity "${target.identity}". Pass --confirm-destructive=${target.identity} to confirm this destructive operation.`,
    );
  }

  const driver = options.storageDriver ?? storageDriver();
  const sql = postgres(databaseUrl, {
    max: 2,
    connect_timeout: 5,
    keep_alive: 10,
    prepare: false,
    onnotice: () => undefined,
  });

  const destinationDir =
    options.destinationDir ?? (await mkdtemp(join(tmpdir(), 'orbit-recovery-drill-')));
  if (options.destinationDir !== undefined) {
    await mkdir(destinationDir, { recursive: true });
  }

  const encryptionKey = options.encryptionKey ?? randomBytes(32).toString('hex');
  const allErrors: string[] = [];

  try {
    const representativeData = await seedDrillRepresentativeData(sql, driver);

    const backupStart = performance.now();
    const backupResult = await createBackup({
      destinationDir,
      databaseUrl,
      encrypt: true,
      encryptionKey,
      storageDriver: driver,
      migrationsFolder: options.migrationsFolder,
    });
    const backupDurationMs = Math.round(performance.now() - backupStart);

    const manifest = backupResult.manifest;
    const backupSizeBytes = await computeDirectorySizeBytes(backupResult.backupDir);

    await wipeDatabaseAndStorage(
      sql,
      driver,
      representativeData,
      options.redisUrl,
      options.skipRedisCheck,
    );

    const restoreStart = performance.now();
    const restoreResult = await restoreBackup({
      backupPath: backupResult.backupDir,
      confirmDestructiveRestoreTarget: options.confirmDestructiveTarget,
      databaseUrl,
      encryptionKey,
      storageDriver: driver,
      redisUrl: options.redisUrl,
      skipRedisCheck: options.skipRedisCheck,
      migrationsFolder: options.migrationsFolder,
    });
    const restoreDurationMs = Math.round(performance.now() - restoreStart);

    if (!restoreResult.validation.valid) {
      allErrors.push(...restoreResult.validation.errors);
    }

    const dataVerification = await verifyDrillRepresentativeData(sql, driver, representativeData);
    if (!dataVerification.valid) {
      allErrors.push(...dataVerification.errors);
    }

    if (options.redisUrl !== undefined && options.skipRedisCheck !== true) {
      const redisVerification = await verifyRedisRealtimeAfterEmpty(options.redisUrl);
      if (!redisVerification.valid) {
        allErrors.push(...redisVerification.errors);
      }
    }

    const metrics: RecoveryDrillMetrics = {
      backupDurationMs,
      restoreDurationMs,
      backupSizeBytes,
      objectsCount: manifest.checksums.objects.length,
      objectsTotalBytes: manifest.checksums.objects.reduce((acc, o) => acc + o.bytes, 0),
      databaseDumpSizeBytes: manifest.checksums.databaseDump.bytes,
      orbitVersion: manifest.orbitVersion,
      sourceRevision: manifest.sourceRevision,
      databaseVersion: manifest.databaseVersion,
      formatVersion: manifest.formatVersion,
      encryptionAlgorithm: manifest.encryption.algorithm ?? 'none',
      attachmentsVerifiedCount: representativeData.attachments.length,
      valid: allErrors.length === 0,
    };

    return {
      success: allErrors.length === 0,
      metrics,
      errors: allErrors,
      representativeData,
    };
  } finally {
    if (options.cleanDestination === true) {
      await rm(destinationDir, { recursive: true, force: true }).catch(() => undefined);
    }
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}
