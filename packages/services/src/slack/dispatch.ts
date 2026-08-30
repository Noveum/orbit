import type { Database, Transaction } from '@orbit/db';
import {
  integration,
  issue,
  member,
  organization,
  slackChannelSync,
  slackUserMapping,
  team,
  user,
  workflowState,
} from '@orbit/db/schema';
import { conflict, type Priority, parseIssueIdentifier } from '@orbit/shared';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { assertCan } from '@orbit/shared/policy';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { decryptSlackBotToken, encryptSlackBotToken } from './credentials.ts';
import {
  buildUnfurl,
  SlackApiError,
  type SlackBlock,
  SlackClient,
  type SlackConversations,
  type SlackIssue,
  type SlackMessageRef,
  type SlackUnfurl,
} from './index.ts';

export type SlackDatabase = Database | Transaction;

const SLACK_TEAM_CLAIMED = 'That Slack workspace is already connected to another Orbit workspace.';

export function slackCredentialVersionExpression(): SQL<string> {
  return sql<string>`coalesce(${integration.config} ->> 'credentialVersion', extract(epoch from ${integration.updatedAt})::text)`;
}

export interface SlackContext {
  readonly integrationId: string;
  readonly integrationVersion: string;
  readonly token: string | null;
  readonly scopes: string[];
  readonly hasDirectMessageScope: boolean;
  readonly reauthorize: boolean;
  readonly updatedAt: Date;
}

export async function resolveSlackContext(
  database: SlackDatabase,
  organizationId: string,
  externalId?: string,
): Promise<SlackContext | null> {
  const filters = [
    eq(integration.organizationId, organizationId),
    eq(integration.provider, 'slack'),
  ];
  if (externalId !== undefined) filters.push(eq(integration.externalId, externalId));
  const [row] = await database
    .select({
      id: integration.id,
      credentials: integration.credentials,
      config: integration.config,
      updatedAt: integration.updatedAt,
      integrationVersion: slackCredentialVersionExpression(),
    })
    .from(integration)
    .where(and(...filters))
    .limit(1);
  if (row === undefined) return null;
  const token = decryptSlackBotToken(row.credentials, {
    organizationId,
    integrationId: row.id,
  });
  const configuredScopes = row.config['scopes'];
  const scopes = Array.isArray(configuredScopes)
    ? configuredScopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  const reauthorize = row.config['slackReauthorize'] === true;
  return {
    integrationId: row.id,
    integrationVersion: row.integrationVersion,
    token,
    scopes,
    hasDirectMessageScope: scopes.includes('im:write') && scopes.includes('chat:write'),
    reauthorize,
    updatedAt: row.updatedAt,
  };
}

export async function listSlackConversations(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly externalId?: string;
    readonly cursor?: string;
  },
): Promise<SlackConversations> {
  const context = await resolveSlackContext(
    database,
    input.organizationId,
    input.externalId ?? 'default',
  );
  if (context === null || context.token === null) return { channels: [], nextCursor: null };
  return await new SlackClient({ token: context.token }).listConversations(
    input.cursor === undefined ? {} : { cursor: input.cursor },
  );
}

export async function sendSlackUnfurls(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly externalId: string;
    readonly channel: string;
    readonly ts: string;
    readonly unfurls: SlackUnfurl;
  },
): Promise<boolean> {
  const context = await resolveSlackContext(database, input.organizationId, input.externalId);
  if (context === null || context.token === null) return false;
  await new SlackClient({ token: context.token }).unfurl({
    channel: input.channel,
    ts: input.ts,
    unfurls: input.unfurls,
  });
  return true;
}

export async function assertSlackIntegrationManager(
  database: SlackDatabase,
  input: { readonly organizationId: string; readonly userId: string },
): Promise<void> {
  const [workspace] = await database
    .select({ deletionRequestedAt: organization.deletionRequestedAt })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1);
  if (workspace !== undefined) assertSlackWorkspaceAvailable(workspace.deletionRequestedAt);
  const [membership] = await database
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
    .limit(1);
  assertSlackManager(input, membership?.role);
}

async function assertSlackIntegrationManagerForUpdate(
  database: Transaction,
  input: { readonly organizationId: string; readonly userId: string },
): Promise<void> {
  const [workspace] = await database
    .select({ deletionRequestedAt: organization.deletionRequestedAt })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1)
    .for('update');
  if (workspace !== undefined) assertSlackWorkspaceAvailable(workspace.deletionRequestedAt);
  const [membership] = await database
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
    .limit(1)
    .for('update');
  assertSlackManager(input, membership?.role);
}

function assertSlackWorkspaceAvailable(deletionRequestedAt: Date | null): void {
  if (deletionRequestedAt !== null) {
    throw conflict('Workspace deletion is in progress.', {
      details: { reason: 'workspace_unavailable' },
    });
  }
}

function assertSlackManager(
  input: { readonly organizationId: string; readonly userId: string },
  role: string | undefined,
): void {
  assertCan(
    {
      organizationId: input.organizationId,
      userId: input.userId,
      role: slackOrganizationRole(role),
      teamIds: [],
    },
    'integration:manage',
  );
}

function slackOrganizationRole(role: string | undefined): OrgRole {
  return ORG_ROLES.find((candidate) => candidate === role) ?? 'guest';
}

export async function upsertSlackUserMapping(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly integrationId: string;
    readonly userId: string;
    readonly slackUserId: string;
    readonly slackDisplayName: string;
  },
): Promise<void> {
  await database
    .delete(slackUserMapping)
    .where(
      and(
        eq(slackUserMapping.integrationId, input.integrationId),
        eq(slackUserMapping.slackUserId, input.slackUserId),
        ne(slackUserMapping.userId, input.userId),
      ),
    );
  await database
    .insert(slackUserMapping)
    .values({ id: randomUUIDv7(), ...input })
    .onConflictDoUpdate({
      target: [slackUserMapping.integrationId, slackUserMapping.userId],
      set: {
        slackUserId: input.slackUserId,
        slackDisplayName: input.slackDisplayName,
        slackChannelId: sql`case when ${slackUserMapping.slackUserId} = ${input.slackUserId} then ${slackUserMapping.slackChannelId} else null end`,
        updatedAt: new Date(),
      },
    });
}

export async function ensureSlackIntegration(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly connectedById: string;
    readonly botToken: string;
    readonly externalId?: string;
    readonly scopes?: readonly string[];
  },
): Promise<string> {
  return (await writeSlackIntegration(database, input)).id;
}

export interface SlackIntegrationWrite {
  readonly id: string;
  readonly integrationVersion: string;
}

export async function ensureSlackIntegrationWithVersion(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly connectedById: string;
    readonly botToken: string;
    readonly externalId?: string;
    readonly scopes?: readonly string[];
  },
): Promise<SlackIntegrationWrite> {
  return await writeSlackIntegration(database, input);
}

async function writeSlackIntegration(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly connectedById: string;
    readonly botToken: string;
    readonly externalId?: string;
    readonly scopes?: readonly string[];
  },
): Promise<SlackIntegrationWrite> {
  try {
    if ('transaction' in database) {
      return await database.transaction(async (tx) => await persistSlackIntegration(tx, input));
    }
    return await persistSlackIntegration(database, input);
  } catch (error) {
    if (slackTeamUniqueViolation(error)) {
      throw conflict(SLACK_TEAM_CLAIMED, { details: { reason: 'slack_team_claimed' } });
    }
    throw error;
  }
}

async function persistSlackIntegration(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly connectedById: string;
    readonly botToken: string;
    readonly externalId?: string;
    readonly scopes?: readonly string[];
  },
): Promise<SlackIntegrationWrite> {
  await assertSlackIntegrationManagerForUpdate(database as Transaction, {
    organizationId: input.organizationId,
    userId: input.connectedById,
  });
  await database.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`slack-integration:${input.organizationId}`}))`,
  );
  const existingRows = await database
    .select({ id: integration.id, externalId: integration.externalId, config: integration.config })
    .from(integration)
    .where(
      and(eq(integration.organizationId, input.organizationId), eq(integration.provider, 'slack')),
    )
    .for('update');
  if (existingRows.length > 1) {
    throw conflict('This workspace has multiple Slack integrations and cannot reconnect safely.');
  }
  await assertSlackTeamUnclaimed(database, input.organizationId, input.externalId);
  const existing = existingRows[0];
  const credentialVersion = randomUUIDv7();
  if (existing === undefined) {
    const integrationId = randomUUIDv7();
    const [created] = await database
      .insert(integration)
      .values({
        id: integrationId,
        organizationId: input.organizationId,
        provider: 'slack',
        externalId: 'default',
        connectedById: input.connectedById,
        credentials: {
          botToken: encryptSlackBotToken({
            organizationId: input.organizationId,
            integrationId,
            token: input.botToken,
          }),
        },
        config: {
          credentialVersion,
          ...(input.externalId === undefined ? {} : { slackTeamId: input.externalId }),
          ...(input.scopes === undefined ? {} : { scopes: [...input.scopes] }),
        },
      })
      .returning({ id: integration.id });
    if (created === undefined) throw new Error('Could not persist the Slack integration.');
    return { id: created.id, integrationVersion: credentialVersion };
  }

  const configuredSlackTeamId = existing.config['slackTeamId'];
  const legacySlackTeamId = existing.externalId === 'default' ? undefined : existing.externalId;
  const previousSlackTeamId =
    typeof configuredSlackTeamId === 'string' ? configuredSlackTeamId : legacySlackTeamId;
  const slackTeamChanged =
    input.externalId !== undefined && previousSlackTeamId !== input.externalId;
  if (slackTeamChanged) {
    await database.delete(slackUserMapping).where(eq(slackUserMapping.integrationId, existing.id));
    await database.delete(slackChannelSync).where(eq(slackChannelSync.integrationId, existing.id));
  }
  const { slackReauthorize: _staleReauthorize, ...previousConfig } = existing.config;
  const slackTeamId = input.externalId ?? previousSlackTeamId;
  const config = {
    ...previousConfig,
    credentialVersion,
    ...(slackTeamId === undefined ? {} : { slackTeamId }),
    ...(input.scopes === undefined ? {} : { scopes: [...input.scopes] }),
  };
  const [updated] = await database
    .update(integration)
    .set({
      externalId: 'default',
      connectedById: input.connectedById,
      credentials: {
        botToken: encryptSlackBotToken({
          organizationId: input.organizationId,
          integrationId: existing.id,
          token: input.botToken,
        }),
      },
      config,
      updatedAt: new Date(),
    })
    .where(eq(integration.id, existing.id))
    .returning({ id: integration.id });
  if (updated === undefined) throw new Error('Could not persist the Slack integration.');
  return { id: updated.id, integrationVersion: credentialVersion };
}

async function assertSlackTeamUnclaimed(
  database: SlackDatabase,
  organizationId: string,
  slackTeamId: string | undefined,
): Promise<void> {
  if (slackTeamId === undefined) return;
  const [claimed] = await database
    .select({ organizationId: integration.organizationId })
    .from(integration)
    .where(
      and(
        eq(integration.provider, 'slack'),
        ne(integration.organizationId, organizationId),
        sql`coalesce(${integration.config} ->> 'slackTeamId', nullif(${integration.externalId}, 'default')) = ${slackTeamId}`,
      ),
    )
    .limit(1);
  if (claimed !== undefined) {
    throw conflict(SLACK_TEAM_CLAIMED, { details: { reason: 'slack_team_claimed' } });
  }
}

function slackTeamUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  if (
    record['code'] === '23505' &&
    (record['constraint_name'] === 'integration_provider_slack_team_idx' ||
      record['constraint'] === 'integration_provider_slack_team_idx')
  ) {
    return true;
  }
  return slackTeamUniqueViolation(record['cause']);
}

export async function connectSlackChannel(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly integrationId: string;
    readonly channelId: string;
    readonly channelName: string;
    readonly teamId: string | null;
  },
): Promise<void> {
  if (input.teamId !== null) {
    await database
      .delete(slackChannelSync)
      .where(
        and(
          eq(slackChannelSync.integrationId, input.integrationId),
          eq(slackChannelSync.teamId, input.teamId),
          ne(slackChannelSync.channelId, input.channelId),
        ),
      );
  }
  await database
    .insert(slackChannelSync)
    .values({
      id: randomUUIDv7(),
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      teamId: input.teamId,
      channelId: input.channelId,
      channelName: input.channelName,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [slackChannelSync.integrationId, slackChannelSync.channelId],
      set: {
        teamId: input.teamId,
        channelName: input.channelName,
        enabled: true,
        updatedAt: new Date(),
      },
    });
}

export async function disconnectSlackChannel(
  database: SlackDatabase,
  input: { readonly integrationId: string; readonly channelId: string },
): Promise<number> {
  const removed = await database
    .delete(slackChannelSync)
    .where(
      and(
        eq(slackChannelSync.integrationId, input.integrationId),
        eq(slackChannelSync.channelId, input.channelId),
      ),
    )
    .returning({ id: slackChannelSync.id });
  return removed.length;
}

export interface SlackTarget {
  readonly channelId: string;
  readonly channelName: string;
}

export async function resolveSlackTargets(
  database: SlackDatabase,
  organizationId: string,
  teamIds: readonly string[],
  integrationId?: string,
): Promise<SlackTarget[]> {
  const scoped =
    teamIds.length === 0
      ? isNull(slackChannelSync.teamId)
      : or(inArray(slackChannelSync.teamId, [...teamIds]), isNull(slackChannelSync.teamId));
  const filters = [
    eq(slackChannelSync.organizationId, organizationId),
    eq(slackChannelSync.enabled, true),
    scoped,
  ];
  if (integrationId !== undefined) filters.push(eq(slackChannelSync.integrationId, integrationId));
  const rows = await database
    .select({ channelId: slackChannelSync.channelId, channelName: slackChannelSync.channelName })
    .from(slackChannelSync)
    .where(and(...filters));
  const seen = new Set<string>();
  const targets: SlackTarget[] = [];
  for (const row of rows) {
    if (seen.has(row.channelId)) continue;
    seen.add(row.channelId);
    targets.push(row);
  }
  return targets;
}

export interface DispatchSlackInput {
  readonly organizationId: string;
  readonly teamIds: readonly string[];
  readonly text: string;
  readonly blocks?: SlackBlock[];
  readonly fetch?: typeof globalThis.fetch;
}

export interface DispatchSlackDmInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly text: string;
  readonly blocks?: SlackBlock[];
  readonly fetch?: typeof globalThis.fetch;
}

export interface SlackDmDispatchResult {
  readonly delivered: number;
  readonly channel: string | null;
  readonly ts: string | null;
}

export async function resolveSlackDmTarget(
  database: SlackDatabase,
  organizationId: string,
  userId: string,
): Promise<{
  readonly context: SlackContext & { readonly token: string };
  readonly mappingId: string;
  readonly slackChannelId: string | null;
  readonly slackUserId: string;
} | null> {
  const context = await resolveSlackContext(database, organizationId, 'default');
  if (
    context === null ||
    context.token === null ||
    context.reauthorize ||
    !context.hasDirectMessageScope
  )
    return null;
  const [mapping] = await database
    .select({
      id: slackUserMapping.id,
      slackChannelId: slackUserMapping.slackChannelId,
      slackUserId: slackUserMapping.slackUserId,
    })
    .from(slackUserMapping)
    .where(
      and(
        eq(slackUserMapping.integrationId, context.integrationId),
        eq(slackUserMapping.organizationId, organizationId),
        eq(slackUserMapping.userId, userId),
      ),
    )
    .limit(1);
  return mapping === undefined
    ? null
    : {
        context: { ...context, token: context.token },
        mappingId: mapping.id,
        slackChannelId: mapping.slackChannelId,
        slackUserId: mapping.slackUserId,
      };
}

export class SlackDmDispatchError extends Error {
  readonly #integrationVersion: string;
  readonly integrationId: string;
  readonly slackCode: string | undefined;
  override readonly cause: unknown;

  constructor(context: SlackContext, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Slack DM dispatch failed');
    this.name = 'SlackDmDispatchError';
    this.#integrationVersion = context.integrationVersion;
    this.integrationId = context.integrationId;
    this.slackCode = cause instanceof SlackApiError ? cause.code : undefined;
    this.cause = cause;
  }

  integrationVersion(): string {
    return this.#integrationVersion;
  }
}

export async function dispatchSlackDmResult(
  database: SlackDatabase,
  input: DispatchSlackDmInput,
): Promise<SlackDmDispatchResult> {
  const target = await resolveSlackDmTarget(database, input.organizationId, input.userId);
  if (target === null) return { delivered: 0, channel: null, ts: null };
  const { context } = target;
  const client = new SlackClient({
    token: context.token,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  try {
    let channel = target.slackChannelId;
    if (channel === null) {
      const openedChannel = await client.openConversation(target.slackUserId);
      channel = openedChannel.channel;
      await database
        .update(slackUserMapping)
        .set({ slackChannelId: channel, updatedAt: new Date() })
        .where(
          and(
            eq(slackUserMapping.id, target.mappingId),
            eq(slackUserMapping.integrationId, context.integrationId),
            eq(slackUserMapping.organizationId, input.organizationId),
            eq(slackUserMapping.userId, input.userId),
          ),
        );
    }
    let message: SlackMessageRef;
    try {
      message = await client.postMessage({
        channel,
        text: input.text,
        ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      });
    } catch (error) {
      if (!(error instanceof SlackApiError) || error.code !== 'channel_not_found') throw error;
      const reopenedChannel = await client.openConversation(target.slackUserId);
      channel = reopenedChannel.channel;
      await database
        .update(slackUserMapping)
        .set({ slackChannelId: channel, updatedAt: new Date() })
        .where(
          and(
            eq(slackUserMapping.id, target.mappingId),
            eq(slackUserMapping.integrationId, context.integrationId),
            eq(slackUserMapping.organizationId, input.organizationId),
            eq(slackUserMapping.userId, input.userId),
          ),
        );
      message = await client.postMessage({
        channel,
        text: input.text,
        ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      });
    }
    return { delivered: 1, channel: message.channel, ts: message.ts };
  } catch (error) {
    throw new SlackDmDispatchError(context, error);
  }
}

export async function dispatchSlackDm(
  database: SlackDatabase,
  input: DispatchSlackDmInput,
): Promise<number> {
  try {
    return (await dispatchSlackDmResult(database, input)).delivered;
  } catch (error) {
    const cause = error instanceof SlackDmDispatchError ? error.cause : error;
    if (cause instanceof SlackApiError) throw cause;
    console.error('[orbit] slack DM post failed', cause);
    throw cause;
  }
}

export async function slackDmAvailable(
  database: SlackDatabase,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  return (await resolveSlackDmTarget(database, organizationId, userId)) !== null;
}

export async function dispatchSlackMessage(
  database: SlackDatabase,
  input: DispatchSlackInput,
): Promise<number> {
  const context = await resolveSlackContext(database, input.organizationId, 'default');
  if (context === null || context.token === null) return 0;
  const targets = await resolveSlackTargets(
    database,
    input.organizationId,
    input.teamIds,
    context.integrationId,
  );
  if (targets.length === 0) return 0;

  const client = new SlackClient({
    token: context.token,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  let delivered = 0;
  for (const target of targets) {
    try {
      await client.postMessage({
        channel: target.channelId,
        text: input.text,
        ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      });
      delivered += 1;
    } catch (error) {
      console.error('[orbit] slack channel post failed', error);
    }
  }
  return delivered;
}

export function issueIdentifierFromUrl(url: string): string | null {
  const match = url.match(/\/issue\/([A-Za-z][A-Za-z0-9]{1,5}-\d+)/);
  const identifier = match?.[1]?.toUpperCase();
  if (identifier === undefined) return null;
  return parseIssueIdentifier(identifier) === null ? null : identifier;
}

export async function loadSlackIssue(
  database: SlackDatabase,
  organizationId: string,
  identifier: string,
  url: string,
): Promise<SlackIssue | null> {
  const [row] = await database
    .select({
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      stateName: workflowState.name,
      teamName: team.name,
      assigneeName: user.name,
      description: issue.description,
    })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .innerJoin(team, eq(team.id, issue.teamId))
    .leftJoin(user, eq(user.id, issue.assigneeId))
    .where(and(eq(issue.organizationId, organizationId), eq(issue.identifier, identifier)))
    .limit(1);
  if (row === undefined) return null;
  return {
    identifier: row.identifier,
    title: row.title,
    url,
    state: row.stateName,
    priority: row.priority as Priority,
    assigneeName: row.assigneeName,
    teamName: row.teamName,
    description: row.description,
  };
}

export async function resolveIssueUnfurls(
  database: SlackDatabase,
  organizationId: string,
  urls: readonly string[],
): Promise<SlackUnfurl> {
  const unfurls: SlackUnfurl = {};
  for (const url of urls) {
    const identifier = issueIdentifierFromUrl(url);
    if (identifier === null) continue;
    const issueForUnfurl = await loadSlackIssue(database, organizationId, identifier, url);
    if (issueForUnfurl === null) continue;
    Object.assign(unfurls, buildUnfurl(url, issueForUnfurl));
  }
  return unfurls;
}
