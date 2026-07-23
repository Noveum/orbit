import type { Database, Transaction } from '@orbit/db';
import { integration, issue, slackChannelSync, team, user, workflowState } from '@orbit/db/schema';
import { type Priority, parseIssueIdentifier } from '@orbit/shared';
import { randomUUIDv7 } from 'bun';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildUnfurl,
  type SlackBlock,
  SlackClient,
  type SlackIssue,
  type SlackUnfurl,
} from './index.ts';

export type SlackDatabase = Database | Transaction;

const credentialsSchema = z.object({ botToken: z.string().min(1).optional() });

export interface SlackContext {
  readonly integrationId: string;
  readonly token: string | null;
}

export async function resolveSlackContext(
  database: SlackDatabase,
  organizationId: string,
): Promise<SlackContext | null> {
  const [row] = await database
    .select({ id: integration.id, credentials: integration.credentials })
    .from(integration)
    .where(and(eq(integration.organizationId, organizationId), eq(integration.provider, 'slack')))
    .limit(1);
  if (row === undefined) return null;
  const parsed = credentialsSchema.safeParse(row.credentials);
  return { integrationId: row.id, token: parsed.success ? (parsed.data.botToken ?? null) : null };
}

export async function ensureSlackIntegration(
  database: SlackDatabase,
  input: {
    readonly organizationId: string;
    readonly connectedById: string;
    readonly botToken: string;
    readonly externalId?: string;
  },
): Promise<string> {
  const externalId = input.externalId ?? 'default';
  const [row] = await database
    .insert(integration)
    .values({
      id: randomUUIDv7(),
      organizationId: input.organizationId,
      provider: 'slack',
      externalId,
      connectedById: input.connectedById,
      credentials: { botToken: input.botToken },
    })
    .onConflictDoUpdate({
      target: [integration.organizationId, integration.provider, integration.externalId],
      set: { credentials: { botToken: input.botToken }, updatedAt: new Date() },
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
