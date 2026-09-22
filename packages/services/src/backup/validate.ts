import { fileURLToPath } from 'node:url';
import { catalogDriftBetween, expectedCatalog, isBehind, liveCatalog } from '@orbit/db/check-drift';
import * as schema from '@orbit/db/schema';
import type { RestoreValidationResult } from '@orbit/shared';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import Redis from 'ioredis';
import postgres from 'postgres';
import { assertSafeKey } from '../storage/key.ts';
import type { StorageDriver } from '../storage/types.ts';

export interface ValidateRestoreOptions {
  readonly databaseUrl: string;
  readonly storageDriver?: StorageDriver | undefined;
  readonly migrationsFolder?: string | undefined;
  readonly redisUrl?: string | undefined;
  readonly skipRedisCheck?: boolean | undefined;
  readonly redisCa?: string | undefined;
}

export interface PingRedisOptions {
  readonly ca?: string | undefined;
}

export function redactRedisEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (url.password.length > 0) {
      url.password = '***';
    }
    if (url.username.length > 0) {
      url.username = '***';
    }
    return url.toString();
  } catch {
    return 'invalid-endpoint';
  }
}

export async function pingRedis(
  endpoint: string,
  options?: PingRedisOptions | undefined,
): Promise<boolean> {
  let client: Redis | undefined;
  try {
    const isTls = endpoint.startsWith('rediss://');
    const ca = options?.ca ?? process.env['REDIS_CA_CERT'] ?? process.env['REDIS_TLS_CA'];
    client = new Redis(endpoint, {
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      enableReadyCheck: false,
      protocol: 2,
      disableClientInfo: true,
      retryStrategy: () => null,
      ...(isTls
        ? {
            tls: {
              ...(ca !== undefined && ca.length > 0 ? { ca } : {}),
            },
          }
        : {}),
    });
    client.on('error', () => undefined);
    await client.connect();
    const result = await client.ping();
    await client.quit().catch(() => client?.disconnect());
    return result === 'PONG';
  } catch {
    if (client !== undefined) {
      client.disconnect();
    }
    return false;
  }
}

function defaultMigrationsFolder(customPath: string | undefined): string {
  return customPath ?? fileURLToPath(new URL('../../../db/drizzle', import.meta.url));
}

interface LedgerCheckResult {
  readonly ledgerCount: number;
  readonly errors: string[];
}

async function checkMigrationLedger(
  sql: postgres.Sql,
  migrationsFolder: string | undefined,
): Promise<LedgerCheckResult> {
  const errors: string[] = [];
  const [tableExistsRow] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
    ) as exists
  `;

  if (tableExistsRow?.exists !== true) {
    errors.push('Migration ledger table "drizzle.__drizzle_migrations" does not exist.');
    return { ledgerCount: 0, errors };
  }

  const rows = await sql<{ hash: string; created_at: string }[]>`
    select hash, created_at::text as created_at
    from drizzle.__drizzle_migrations
    order by created_at, id
  `;

  const folder = defaultMigrationsFolder(migrationsFolder);
  const committedMigrations = readMigrationFiles({ migrationsFolder: folder });

  if (rows.length > committedMigrations.length) {
    errors.push(
      `Database migration ledger (${rows.length}) is ahead of committed migrations (${committedMigrations.length}).`,
    );
    return { ledgerCount: rows.length, errors };
  }

  for (const [index, row] of rows.entries()) {
    const committed = committedMigrations[index];
    if (committed === undefined || row.created_at !== String(committed.folderMillis)) {
      errors.push(
        `Database migration ledger is not a contiguous prefix of committed migrations at index ${index}.`,
      );
      break;
    }
    if (row.hash !== committed.hash) {
      errors.push(
        `Migration ${row.created_at} hash in database does not match committed migration file.`,
      );
      break;
    }
  }

  return { ledgerCount: rows.length, errors };
}

interface CatalogCheckResult {
  readonly behind: boolean;
  readonly errors: string[];
}

async function checkCatalogDrift(databaseUrl: string): Promise<CatalogCheckResult> {
  const errors: string[] = [];
  try {
    const live = await liveCatalog(databaseUrl);
    const drift = catalogDriftBetween(expectedCatalog(schema), live);
    const behind = isBehind(drift);
    if (behind) {
      errors.push('Database catalog has missing tables, columns, or incompatible drift.');
    }
    return { behind, errors };
  } catch (driftError) {
    errors.push(`Catalog drift check failed: ${String(driftError)}`);
    return { behind: true, errors };
  }
}

interface EntityCounts {
  readonly organizationsCount: number;
  readonly usersCount: number;
  readonly membersCount: number;
  readonly teamsCount: number;
  readonly issuesCount: number;
  readonly docsCount: number;
  readonly attachmentsCount: number;
  readonly mcpGrantsCount: number;
  readonly accountsCount: number;
}

async function fetchEntityCounts(sql: postgres.Sql): Promise<EntityCounts> {
  const [orgCountRow] = await sql<
    { count: number }[]
  >`select count(*)::int as count from organization`;
  const [userCountRow] = await sql<{ count: number }[]>`select count(*)::int as count from "user"`;
  const [memberCountRow] = await sql<
    { count: number }[]
  >`select count(*)::int as count from member`;
  const [teamCountRow] = await sql<{ count: number }[]>`select count(*)::int as count from team`;
  const [issueCountRow] = await sql<{ count: number }[]>`select count(*)::int as count from issue`;
  const [docCountRow] = await sql<{ count: number }[]>`select count(*)::int as count from doc`;
  const [attachmentCountRow] = await sql<
    { count: number }[]
  >`select count(*)::int as count from attachment`;
  const [mcpGrantCountRow] = await sql<
    { count: number }[]
  >`select count(*)::int as count from mcp_grant`;
  const [accountCountRow] = await sql<
    { count: number }[]
  >`select count(*)::int as count from account`;

  return {
    organizationsCount: orgCountRow?.count ?? 0,
    usersCount: userCountRow?.count ?? 0,
    membersCount: memberCountRow?.count ?? 0,
    teamsCount: teamCountRow?.count ?? 0,
    issuesCount: issueCountRow?.count ?? 0,
    docsCount: docCountRow?.count ?? 0,
    attachmentsCount: attachmentCountRow?.count ?? 0,
    mcpGrantsCount: mcpGrantCountRow?.count ?? 0,
    accountsCount: accountCountRow?.count ?? 0,
  };
}

interface ReferentialCheckResult {
  readonly referentialIntegrityPassed: boolean;
  readonly errors: string[];
}

async function checkReferentialIntegrity(sql: postgres.Sql): Promise<ReferentialCheckResult> {
  const errors: string[] = [];
  let referentialIntegrityPassed = true;

  const [danglingMembers] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from member m
    left join organization o on m.organization_id = o.id
    left join "user" u on m.user_id = u.id
    where o.id is null or u.id is null
  `;
  if ((danglingMembers?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(
      `Found ${danglingMembers?.count} dangling member row(s) missing organization or user.`,
    );
  }

  const [danglingTeams] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from team t
    left join organization o on t.organization_id = o.id
    where o.id is null
  `;
  if ((danglingTeams?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(`Found ${danglingTeams?.count} dangling team row(s) missing organization.`);
  }

  const [danglingTeamMembers] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from team_member tm
    left join team t on tm.team_id = t.id
    left join "user" u on tm.user_id = u.id
    where t.id is null or u.id is null
  `;
  if ((danglingTeamMembers?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(`Found ${danglingTeamMembers?.count} dangling team_member row(s).`);
  }

  const [danglingIssues] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from issue i
    left join organization o on i.organization_id = o.id
    left join team t on i.team_id = t.id
    where o.id is null or t.id is null
  `;
  if ((danglingIssues?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(
      `Found ${danglingIssues?.count} dangling issue row(s) missing organization or team.`,
    );
  }

  const [danglingProjects] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from project p
    left join organization o on p.organization_id = o.id
    where o.id is null
  `;
  if ((danglingProjects?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(`Found ${danglingProjects?.count} dangling project row(s) missing organization.`);
  }

  const [danglingDocs] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from doc d
    left join organization o on d.organization_id = o.id
    left join "user" u on d.author_id = u.id
    where o.id is null or u.id is null
  `;
  if ((danglingDocs?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(`Found ${danglingDocs?.count} dangling doc row(s) missing organization or author.`);
  }

  const [danglingComments] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from comment c
    left join organization o on c.organization_id = o.id
    left join issue i on c.issue_id = i.id
    where o.id is null or i.id is null
  `;
  if ((danglingComments?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(`Found ${danglingComments?.count} dangling comment row(s).`);
  }

  const [danglingAttachments] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from attachment a
    left join organization o on a.organization_id = o.id
    left join "user" u on a.uploaded_by_id = u.id
    where o.id is null or u.id is null
  `;
  if ((danglingAttachments?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(`Found ${danglingAttachments?.count} dangling attachment row(s).`);
  }

  const [danglingMcpGrants] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from mcp_grant g
    left join oauth_application a on g.client_id = a.client_id
    left join "user" u on g.user_id = u.id
    left join organization o on g.organization_id = o.id
    where a.client_id is null or u.id is null or o.id is null
  `;
  if ((danglingMcpGrants?.count ?? 0) > 0) {
    referentialIntegrityPassed = false;
    errors.push(
      `Found ${danglingMcpGrants?.count} dangling mcp_grant row(s) missing oauth app, user, or organization.`,
    );
  }

  return { referentialIntegrityPassed, errors };
}

interface BootstrapCheckResult {
  readonly bootstrapWindowClosed: boolean;
  readonly errors: string[];
}

async function checkBootstrapAndOwnership(
  sql: postgres.Sql,
  organizationsCount: number,
  usersCount: number,
): Promise<BootstrapCheckResult> {
  const errors: string[] = [];

  if (organizationsCount > 0) {
    const [unownedOrgs] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from organization o
      where not exists (
        select 1 from member m where m.organization_id = o.id
      )
    `;
    if ((unownedOrgs?.count ?? 0) > 0) {
      errors.push(`Found ${unownedOrgs?.count} organization(s) without any member.`);
    }
  }

  let bootstrapWindowClosed: boolean;
  if (usersCount > 0 && organizationsCount > 0) {
    bootstrapWindowClosed = true;
  } else if (usersCount === 0 && organizationsCount === 0) {
    bootstrapWindowClosed = false;
  } else {
    bootstrapWindowClosed = false;
    errors.push('Inconsistent bootstrap state: partial users or organizations detected.');
  }

  return { bootstrapWindowClosed, errors };
}

interface StorageCheckResult {
  readonly checkedObjects: number;
  readonly missingObjects: number;
  readonly sizeMismatches: number;
  readonly errors: string[];
}

async function checkStorageObjects(
  databaseUrl: string,
  driver: StorageDriver,
): Promise<StorageCheckResult> {
  const errors: string[] = [];
  let checkedObjects = 0;
  let missingObjects = 0;
  let sizeMismatches = 0;

  const checkSql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    prepare: false,
  });
  try {
    const activeAttachments = await checkSql<
      {
        id: string;
        storage_key: string;
        size: number;
        content_type: string;
      }[]
    >`
      select id, storage_key, size::int as size, content_type
      from attachment
      where status = 'ready'
    `;

    checkedObjects = activeAttachments.length;

    for (const att of activeAttachments) {
      const safeKey = assertSafeKey(att.storage_key);
      const objStat = await driver.stat(safeKey);
      if (objStat === null) {
        missingObjects += 1;
        errors.push(
          `Referenced object "${safeKey}" for attachment "${att.id}" was not found in storage.`,
        );
        continue;
      }

      if (objStat.size !== att.size) {
        sizeMismatches += 1;
        errors.push(
          `Referenced object "${safeKey}" size mismatch: attachment row declares ${att.size} bytes, storage has ${objStat.size} bytes.`,
        );
        continue;
      }

      const data = await driver.get(safeKey);
      if (data === null || data.byteLength !== att.size) {
        missingObjects += 1;
        errors.push(`Referenced object "${safeKey}" could not be read with expected size.`);
      }
    }
  } finally {
    await checkSql.end({ timeout: 5 });
  }

  return { checkedObjects, missingObjects, sizeMismatches, errors };
}

export async function validateRestore(
  options: ValidateRestoreOptions,
): Promise<RestoreValidationResult> {
  const startTime = Date.now();
  const {
    databaseUrl,
    storageDriver: driver,
    migrationsFolder,
    redisUrl,
    skipRedisCheck,
  } = options;

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    prepare: false,
  });

  const allErrors: string[] = [];
  let databaseVersion = 'unknown';
  let ledgerCount = 0;
  let behind = false;
  let counts: EntityCounts = {
    organizationsCount: 0,
    usersCount: 0,
    membersCount: 0,
    teamsCount: 0,
    issuesCount: 0,
    docsCount: 0,
    attachmentsCount: 0,
    mcpGrantsCount: 0,
    accountsCount: 0,
  };
  let referentialIntegrityPassed = true;
  let bootstrapWindowClosed = false;

  try {
    const [versionRow] = await sql<{ version: string }[]>`select version() as version`;
    if (versionRow === undefined) {
      allErrors.push('Unable to determine PostgreSQL version.');
    } else {
      databaseVersion = versionRow.version;
    }

    const ledgerResult = await checkMigrationLedger(sql, migrationsFolder);
    ledgerCount = ledgerResult.ledgerCount;
    allErrors.push(...ledgerResult.errors);

    const catalogResult = await checkCatalogDrift(databaseUrl);
    behind = catalogResult.behind;
    allErrors.push(...catalogResult.errors);

    counts = await fetchEntityCounts(sql);

    const refResult = await checkReferentialIntegrity(sql);
    referentialIntegrityPassed = refResult.referentialIntegrityPassed;
    allErrors.push(...refResult.errors);

    const bootstrapResult = await checkBootstrapAndOwnership(
      sql,
      counts.organizationsCount,
      counts.usersCount,
    );
    bootstrapWindowClosed = bootstrapResult.bootstrapWindowClosed;
    allErrors.push(...bootstrapResult.errors);
  } finally {
    await sql.end({ timeout: 5 });
  }

  let checkedObjects = 0;
  let missingObjects = 0;
  let sizeMismatches = 0;

  if (driver !== undefined) {
    const storageResult = await checkStorageObjects(databaseUrl, driver);
    checkedObjects = storageResult.checkedObjects;
    missingObjects = storageResult.missingObjects;
    sizeMismatches = storageResult.sizeMismatches;
    allErrors.push(...storageResult.errors);
  }

  let redisTested = false;
  const emptyStartSafe = true;

  const redisEndpoint = redisUrl ?? process.env['REDIS_URL'];
  if (skipRedisCheck !== true && redisEndpoint !== undefined && redisEndpoint.length > 0) {
    redisTested = await pingRedis(redisEndpoint, { ca: options.redisCa });
    if (!redisTested) {
      allErrors.push(
        `Failed to ping configured Redis endpoint: ${redactRedisEndpoint(redisEndpoint)}`,
      );
    }
  }

  const valid = allErrors.length === 0;
  const durationMs = Date.now() - startTime;

  return {
    valid,
    migrationStatus: {
      ledgerCount,
      isBehind: behind,
      databaseVersion,
    },
    integrity: {
      organizations: counts.organizationsCount,
      users: counts.usersCount,
      members: counts.membersCount,
      teams: counts.teamsCount,
      issues: counts.issuesCount,
      docs: counts.docsCount,
      attachments: counts.attachmentsCount,
      mcpGrants: counts.mcpGrantsCount,
      referentialIntegrityPassed,
    },
    storage: {
      checkedObjects,
      missingObjects,
      sizeMismatches,
    },
    auth: {
      accountsCount: counts.accountsCount,
      bootstrapWindowClosed,
    },
    redis: {
      tested: redisTested,
      emptyStartSafe,
    },
    durationMs,
    errors: allErrors,
  };
}
