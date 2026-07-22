import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  internal,
  PRIORITY_LABELS,
  type Priority,
  rateLimited,
  truncate,
  unauthorized,
} from '@orbit/shared';
import { z } from 'zod';

export const SLACK_REPLAY_WINDOW_SECONDS = 300;
export const SLACK_API_BASE = 'https://slack.com/api';

export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret: string,
  now: Date = new Date(),
): boolean {
  if (signingSecret.length === 0 || signature.length === 0) return false;
  const sentAt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(sentAt)) return false;
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - sentAt);
  if (skew > SLACK_REPLAY_WINDOW_SECONDS) return false;

  const digest = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  const expected = Buffer.from(`v0=${digest}`, 'utf8');
  const received = Buffer.from(signature, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export type SlackBlock = Record<string, unknown>;

export interface SlackIssue {
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly priority: Priority;
  readonly assigneeName: string | null;
  readonly teamName?: string;
  readonly description?: string;
}

export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function unescapeSlackText(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function field(label: string, value: string): SlackBlock {
  return { type: 'mrkdwn', text: `*${label}*\n${escapeSlackText(value)}` };
}

export function issueBlocks(issue: SlackIssue): SlackBlock[] {
  const fields: SlackBlock[] = [
    field('Status', issue.state),
    field('Priority', PRIORITY_LABELS[issue.priority]),
    field('Assignee', issue.assigneeName ?? 'Unassigned'),
  ];
  if (issue.teamName !== undefined) fields.push(field('Team', issue.teamName));

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${issue.url}|${escapeSlackText(issue.identifier)}>* ${escapeSlackText(issue.title)}`,
      },
    },
    { type: 'section', fields },
  ];

  if (issue.description !== undefined && issue.description.trim().length > 0) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: truncate(escapeSlackText(issue.description.trim()), 280) },
      ],
    });
  }

  blocks.push({
    type: 'actions',
    block_id: `orbit_issue_${issue.identifier}`,
    elements: [
      {
        type: 'button',
        action_id: 'orbit_open_issue',
        text: { type: 'plain_text', text: 'Open in Orbit' },
        url: issue.url,
      },
      {
        type: 'button',
        action_id: 'orbit_assign_self',
        value: issue.identifier,
        text: { type: 'plain_text', text: 'Assign to me' },
      },
      {
        type: 'button',
        action_id: 'orbit_mark_done',
        style: 'primary',
        value: issue.identifier,
        text: { type: 'plain_text', text: 'Mark done' },
      },
    ],
  });

  return blocks;
}

export interface SlackUnfurl {
  readonly [url: string]: { readonly blocks: SlackBlock[] };
}

export function buildUnfurl(url: string, issue: SlackIssue): SlackUnfurl {
  return { [url]: { blocks: issueBlocks(issue) } };
}

export const slashCommandSchema = z.object({
  command: z.string().min(1).max(64),
  text: z.string().max(3000).default(''),
  team_id: z.string().min(1).max(64),
  channel_id: z.string().min(1).max(64),
  user_id: z.string().min(1).max(64),
  response_url: z.string().url().max(2048).optional(),
  trigger_id: z.string().max(128).optional(),
});

export type SlashCommandPayload = z.infer<typeof slashCommandSchema>;

export type SlackCommand =
  | { readonly kind: 'new'; readonly title: string }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'unknown'; readonly text: string };

export function commandParser(input: string): SlackCommand {
  const text = unescapeSlackText(input)
    .trim()
    .replace(/^\/orbit\b/i, '')
    .trim();
  if (text.length === 0) return { kind: 'help' };

  const separator = text.search(/\s/);
  const verb = (separator === -1 ? text : text.slice(0, separator)).toLowerCase();
  const rest = separator === -1 ? '' : text.slice(separator + 1).trim();

  if (verb === 'help') return { kind: 'help' };
  if (verb === 'new' || verb === 'create') {
    return rest.length === 0 ? { kind: 'help' } : { kind: 'new', title: rest };
  }
  if (verb === 'search' || verb === 'find') {
    return rest.length === 0 ? { kind: 'help' } : { kind: 'search', query: rest };
  }
  return { kind: 'unknown', text };
}

const slackResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const postMessageResponseSchema = slackResponseSchema.extend({
  ts: z.string().optional(),
  channel: z.string().optional(),
});

const viewResponseSchema = slackResponseSchema.extend({
  view: z.object({ id: z.string() }).optional(),
});

const conversationsResponseSchema = slackResponseSchema.extend({
  channels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        is_private: z.boolean().optional(),
        is_archived: z.boolean().optional(),
      }),
    )
    .default([]),
  response_metadata: z.object({ next_cursor: z.string().default('') }).optional(),
});

export interface SlackMessageRef {
  readonly channel: string;
  readonly ts: string;
}

export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly isArchived: boolean;
}

export interface SlackConversations {
  readonly channels: SlackChannel[];
  readonly nextCursor: string | null;
}

export interface SlackClientOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface PostMessageInput {
  readonly channel: string;
  readonly text: string;
  readonly blocks?: SlackBlock[];
  readonly threadTs?: string;
  readonly unfurlLinks?: boolean;
}

export interface UpdateMessageInput {
  readonly channel: string;
  readonly ts: string;
  readonly text: string;
  readonly blocks?: SlackBlock[];
}

export class SlackClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: SlackClientOptions) {
    if (options.token.length === 0) throw unauthorized('A Slack token is required.');
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? SLACK_API_BASE;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async postMessage(input: PostMessageInput): Promise<SlackMessageRef> {
    const body = await this.call('chat.postMessage', postMessageResponseSchema, {
      channel: input.channel,
      text: input.text,
      ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      ...(input.threadTs === undefined ? {} : { thread_ts: input.threadTs }),
      ...(input.unfurlLinks === undefined ? {} : { unfurl_links: input.unfurlLinks }),
    });
    return { channel: body.channel ?? input.channel, ts: body.ts ?? '' };
  }

  async updateMessage(input: UpdateMessageInput): Promise<SlackMessageRef> {
    const body = await this.call('chat.update', postMessageResponseSchema, {
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
    });
    return { channel: body.channel ?? input.channel, ts: body.ts ?? input.ts };
  }

  async openView(triggerId: string, view: Record<string, unknown>): Promise<string> {
    const body = await this.call('views.open', viewResponseSchema, {
      trigger_id: triggerId,
      view,
    });
    return body.view?.id ?? '';
  }

  async listConversations(
    options: { readonly cursor?: string; readonly limit?: number; readonly types?: string } = {},
  ): Promise<SlackConversations> {
    const body = await this.call('conversations.list', conversationsResponseSchema, {
      limit: options.limit ?? 200,
      types: options.types ?? 'public_channel,private_channel',
      exclude_archived: true,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    });
    const nextCursor = body.response_metadata?.next_cursor ?? '';
    return {
      channels: body.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private ?? false,
        isArchived: channel.is_archived ?? false,
      })),
      nextCursor: nextCursor.length > 0 ? nextCursor : null,
    };
  }

  private async call<T extends z.ZodTypeAny>(
    method: string,
    schema: T,
    payload: Record<string, unknown>,
  ): Promise<z.infer<T>> {
    const response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 429) throw rateLimited('Slack is rate limiting Orbit.');
    if (!response.ok) throw internal(`Slack ${method} returned HTTP ${response.status}.`);

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw internal(`Slack ${method} returned an unexpected payload.`);
    const body = parsed.data as z.infer<typeof slackResponseSchema>;
    if (!body.ok) throw internal(`Slack ${method} failed: ${body.error ?? 'unknown_error'}.`);
    return parsed.data;
  }
}
