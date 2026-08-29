import type { Database, Transaction } from '@orbit/db';
import {
  integration,
  issue,
  slackChannelSync,
  slackUserMapping,
  team,
  user,
  workflowState,
} from '@orbit/db/schema';
import { type Priority, parseIssueIdentifier } from '@orbit/shared';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildUnfurl,
  SlackApiError,
  type SlackBlock,
  SlackClient,
  type SlackIssue,
  type SlackMessageRef,
  type SlackUnfurl,
} from './index.ts';

export type SlackDatabase = Database | Transaction;

const credentialsSchema = z.object({ botToken: z.string().min(1).optional() });

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
      integrationVersion: sql<string>`extract(epoch from ${integration.updatedAt})::text`,
    })
    .from(integration)
    .where(and(...filters))
    .limit(1);
  if (row === undefined) return null;
  const parsed = credentialsSchema.safeParse(row.credentials);
  const configuredScopes = row.config['scopes'];
  const scopes = Array.isArray(configuredScopes)
    ? configuredScopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  const reauthorize = row.config['slackReauthorize'] === true;
  return {
    integrationId: row.id,
    integrationVersion: row.integrationVersion,
    token: parsed.success ? (parsed.data.botToken ?? null) : null,
    scopes,
    hasDirectMessageScope: scopes.includes('im:write') && scopes.includes('chat:write'),
    reauthorize,
    updatedAt: row.updatedAt,
  };
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
  const externalId = 'default';
  const [existing] = await database
    .select({ config: integration.config })
    .from(integration)
    .where(
      and(
        eq(integration.organizationId, input.organizationId),
        eq(integration.provider, 'slack'),
        eq(integration.externalId, externalId),
      ),
    )
    .limit(1)
    .for('update');
  const { slackReauthorize: _staleReauthorize, ...previousConfig } = existing?.config ?? {};
  const config = {
    ...previousConfig,
    ...(input.externalId === undefined ? {} : { slackTeamId: input.externalId }),
    ...(input.scopes === undefined ? {} : { scopes: [...input.scopes] }),
  };
  const [row] = await database
    .insert(integration)
    .values({
      id: randomUUIDv7(),
      organizationId: input.organizationId,
      provider: 'slack',
      externalId,
      connectedById: input.connectedById,
      credentials: { botToken: input.botToken },
      config,
    })
    .onConflictDoUpdate({
      target: [integration.organizationId, integration.provider, integration.externalId],
      set: {
        credentials: { botToken: input.botToken },
        config,
        updatedAt: new Date(),
      },
    })
    .returning({ id: integration.id });
  if (row === undefined) throw new Error('Could not persist the Slack integration.');
  return row.id;
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
): Promise<SlackTarget[]> {
  const scoped =
    teamIds.length === 0
      ? isNull(slackChannelSync.teamId)
      : or(inArray(slackChannelSync.teamId, [...teamIds]), isNull(slackChannelSync.teamId));
  const rows = await database
    .select({ channelId: slackChannelSync.channelId, channelName: slackChannelSync.channelName })
    .from(slackChannelSync)
    .where(
      and(
        eq(slackChannelSync.organizationId, organizationId),
        eq(slackChannelSync.enabled, true),
        scoped,
      ),
    );
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
  readonly slackUserId: string;
} | null> {
  const context = await resolveSlackContext(database, organizationId);
  if (
    context === null ||
    context.token === null ||
    context.reauthorize ||
    !context.hasDirectMessageScope
  )
    return null;
  const [mapping] = await database
    .select({ slackUserId: slackUserMapping.slackUserId })
    .from(slackUserMapping)
    .where(
      and(
        eq(slackUserMapping.integrationId, context.integrationId),
        eq(slackUserMapping.userId, userId),
      ),
    )
    .limit(1);
  return mapping === undefined
    ? null
    : { context: { ...context, token: context.token }, slackUserId: mapping.slackUserId };
}

export class SlackDmDispatchError extends Error {
  readonly #integrationToken: string;
  readonly #integrationVersion: string;
  readonly integrationId: string;
  readonly slackCode: string | undefined;
  override readonly cause: unknown;

  constructor(context: SlackContext, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Slack DM dispatch failed');
    this.name = 'SlackDmDispatchError';
    this.#integrationToken = context.token ?? '';
    this.#integrationVersion = context.integrationVersion;
    this.integrationId = context.integrationId;
    this.slackCode = cause instanceof SlackApiError ? cause.slackCode : undefined;
    this.cause = cause;
  }

  tokenUsed(): string {
    return this.#integrationToken;
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
    const [mapping] = await database
      .select({ id: slackUserMapping.id, channelId: slackUserMapping.slackChannelId })
      .from(slackUserMapping)
      .where(
        and(
          eq(slackUserMapping.integrationId, context.integrationId),
          eq(slackUserMapping.userId, input.userId),
        ),
      )
      .limit(1);
    if (mapping === undefined) return { delivered: 0, channel: null, ts: null };
    let channel = mapping.channelId;
    if (channel === null) {
      const openedChannel = await client.openConversation(target.slackUserId);
      channel = openedChannel.channel;
      await database
        .update(slackUserMapping)
        .set({ slackChannelId: channel, updatedAt: new Date() })
        .where(eq(slackUserMapping.id, mapping.id));
    }
    let message: SlackMessageRef;
    try {
      message = await client.postMessage({
        channel,
        text: input.text,
        ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      });
    } catch (error) {
      if (!(error instanceof SlackApiError) || error.slackCode !== 'channel_not_found') throw error;
      const reopenedChannel = await client.openConversation(target.slackUserId);
      channel = reopenedChannel.channel;
      await database
        .update(slackUserMapping)
        .set({ slackChannelId: channel, updatedAt: new Date() })
        .where(eq(slackUserMapping.id, mapping.id));
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
  const context = await resolveSlackContext(database, input.organizationId);
  if (context === null || context.token === null) return 0;
  const targets = await resolveSlackTargets(database, input.organizationId, input.teamIds);
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
