import { createHmac, timingSafeEqual } from 'node:crypto';
import { internal, PRIORITY_LABELS, type Priority, truncate, unauthorized } from '@orbit/shared';
import { z } from 'zod';

export const SLACK_REPLAY_WINDOW_SECONDS = 300;
export const SLACK_API_BASE = 'https://slack.com/api';
export const SLACK_REQUEST_TIMEOUT_MS = 10_000;
const SLACK_USER_DIRECTORY_MAX_PAGES = 5_000;
const SLACK_USER_DIRECTORY_MAX_DURATION_MS = 30_000;

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
  return timingSafeEqual(new Uint8Array(expected), new Uint8Array(received));
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

  return blocks;
}

export interface SlackUnfurl {
  readonly [url: string]: { readonly blocks: SlackBlock[] };
}

export function buildUnfurl(url: string, issue: SlackIssue): SlackUnfurl {
  return { [url]: { blocks: issueBlocks(issue) } };
}

export {
  type SlackEvent,
  slackEventCallbackSchema,
  slackEventSchema,
  slackUrlVerificationSchema,
} from '@orbit/shared/validators';

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

const postMessageResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    ts: z.string().min(1),
    channel: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().optional(),
  }),
]);

const viewResponseSchema = slackResponseSchema.extend({
  view: z.object({ id: z.string() }).optional(),
});

const openConversationResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    channel: z.object({ id: z.string().min(1) }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().optional(),
  }),
]);

const conversationsResponseSchema = slackResponseSchema.extend({
  channels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        is_private: z.boolean().optional(),
        is_archived: z.boolean().optional(),
        is_member: z.boolean().optional(),
      }),
    )
    .default([]),
  response_metadata: z.object({ next_cursor: z.string().default('') }).optional(),
});

const conversationResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    channel: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      is_private: z.boolean(),
      is_archived: z.boolean(),
      is_member: z.boolean(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().optional(),
  }),
]);

const usersResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    members: z.array(z.unknown()),
    response_metadata: z.object({ next_cursor: z.string() }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().optional(),
  }),
]);

const directoryMemberSchema = z.object({
  id: z.string().min(1),
  deleted: z.boolean().optional(),
  is_bot: z.boolean().optional(),
  is_app_user: z.boolean().optional(),
  real_name: z.string().nullable().optional(),
  profile: z
    .object({
      email: z.string().nullable().optional(),
      display_name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

type SuccessfulSlackResponse<T extends z.ZodTypeAny> =
  z.infer<T> extends infer ResponseBody
    ? ResponseBody extends { ok: false }
      ? never
      : ResponseBody
    : never;

export interface SlackMessageRef {
  readonly channel: string;
  readonly ts: string;
}

export class SlackApiError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly method: string,
    readonly code: string,
    retryAfterMs?: number,
  ) {
    super(`Slack ${method} failed: ${code}.`);
    this.name = 'SlackApiError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly isArchived: boolean;
  readonly isMember: boolean;
}

export interface SlackConversations {
  readonly channels: SlackChannel[];
  readonly nextCursor: string | null;
}

export interface SlackUser {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string;
}

function slackUserFromDirectoryMember(value: unknown): SlackUser | null {
  const parsedMember = directoryMemberSchema.safeParse(value);
  if (!parsedMember.success) return null;
  const member = parsedMember.data;
  if (member.deleted === true || member.is_bot !== false || member.is_app_user === true)
    return null;
  const parsedEmail = z.email().safeParse(member.profile?.email?.trim().toLowerCase());
  if (!parsedEmail.success) return null;
  return {
    id: member.id,
    email: parsedEmail.data,
    displayName: member.profile?.display_name || member.real_name || '',
  };
}

function nextSlackDirectoryCursor(nextCursor: string, seenCursors: Set<string>): string | null {
  if (nextCursor.length === 0) return null;
  if (seenCursors.has(nextCursor)) {
    throw internal('Slack users.list returned a repeated cursor.');
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

function assertSlackDirectoryWithinLimits(
  pageCount: number,
  startedAt: number,
  pageLimit: number,
): void {
  if (pageCount >= pageLimit) {
    throw internal('Slack users.list exceeded the safe page limit.');
  }
  if (Date.now() - startedAt >= SLACK_USER_DIRECTORY_MAX_DURATION_MS) {
    throw internal('Slack users.list exceeded the safe duration limit.');
  }
}

function slackDirectoryRetryAfter(error: unknown, startedAt: number): number | null {
  if (!(error instanceof SlackApiError) || error.code !== 'ratelimited') return null;
  if (error.retryAfterMs === undefined) return null;
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const remainingMs = SLACK_USER_DIRECTORY_MAX_DURATION_MS - elapsedMs - SLACK_REQUEST_TIMEOUT_MS;
  return error.retryAfterMs < remainingMs ? error.retryAfterMs : null;
}

function waitForSlackDirectoryRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

type SlackUserDirectoryPage = SuccessfulSlackResponse<typeof usersResponseSchema>;

async function requestSlackDirectoryPage(
  request: () => Promise<SlackUserDirectoryPage>,
  startedAt: number,
  retryAvailable: boolean,
): Promise<{ readonly body: SlackUserDirectoryPage; readonly retried: boolean }> {
  try {
    return { body: await request(), retried: false };
  } catch (error) {
    const retryAfterMs = slackDirectoryRetryAfter(error, startedAt);
    if (!retryAvailable || retryAfterMs === null) throw error;
    await waitForSlackDirectoryRetry(retryAfterMs);
    if (Date.now() - startedAt >= SLACK_USER_DIRECTORY_MAX_DURATION_MS) throw error;
    return { body: await request(), retried: true };
  }
}

export interface SlackClientOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly userDirectoryPageLimit?: number;
}

export interface PostMessageInput {
  readonly channel: string;
  readonly text: string;
  readonly blocks?: SlackBlock[];
  readonly clientMsgId?: string;
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
  private readonly userDirectoryPageLimit: number;

  constructor(options: SlackClientOptions) {
    if (options.token.length === 0) throw unauthorized('A Slack token is required.');
    const userDirectoryPageLimit = options.userDirectoryPageLimit ?? SLACK_USER_DIRECTORY_MAX_PAGES;
    if (!Number.isSafeInteger(userDirectoryPageLimit) || userDirectoryPageLimit < 1) {
      throw internal('The Slack user directory page limit must be a positive integer.');
    }
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? SLACK_API_BASE;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userDirectoryPageLimit = Math.min(userDirectoryPageLimit, SLACK_USER_DIRECTORY_MAX_PAGES);
  }

  async postMessage(input: PostMessageInput): Promise<SlackMessageRef> {
    const body = await this.call('chat.postMessage', postMessageResponseSchema, {
      channel: input.channel,
      text: input.text,
      ...(input.clientMsgId === undefined ? {} : { client_msg_id: input.clientMsgId }),
      ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      ...(input.threadTs === undefined ? {} : { thread_ts: input.threadTs }),
      ...(input.unfurlLinks === undefined ? {} : { unfurl_links: input.unfurlLinks }),
    });
    if (!body.ok) throw internal('Slack chat.postMessage did not return a message identity.');
    return { channel: body.channel, ts: body.ts };
  }

  async openConversation(userId: string): Promise<{ channel: string }> {
    const body = await this.call('conversations.open', openConversationResponseSchema, {
      users: userId,
    });
    if (!body.ok) throw internal('Slack conversations.open did not return a channel.');
    return { channel: body.channel.id };
  }

  async updateMessage(input: UpdateMessageInput): Promise<SlackMessageRef> {
    const body = await this.call('chat.update', postMessageResponseSchema, {
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
    });
    if (!body.ok) throw internal('Slack chat.update did not return a message identity.');
    return { channel: body.channel, ts: body.ts };
  }

  async unfurl(input: {
    readonly channel: string;
    readonly ts: string;
    readonly unfurls: SlackUnfurl;
  }): Promise<void> {
    await this.call('chat.unfurl', slackResponseSchema, {
      channel: input.channel,
      ts: input.ts,
      unfurls: input.unfurls,
    });
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
        isMember: channel.is_member ?? false,
      })),
      nextCursor: nextCursor.length > 0 ? nextCursor : null,
    };
  }

  async conversation(channelId: string): Promise<SlackChannel> {
    const body = await this.callQuery('conversations.info', conversationResponseSchema, {
      channel: channelId,
    });
    return {
      id: body.channel.id,
      name: body.channel.name,
      isPrivate: body.channel.is_private,
      isArchived: body.channel.is_archived,
      isMember: body.channel.is_member,
    };
  }

  async listUsers(): Promise<SlackUser[]> {
    const users: SlackUser[] = [];
    const seenCursors = new Set<string>();
    const startedAt = Date.now();
    let pageCount = 0;
    let cursor: string | null = null;
    let rateLimitRetryUsed = false;
    do {
      assertSlackDirectoryWithinLimits(pageCount, startedAt, this.userDirectoryPageLimit);
      pageCount += 1;
      const page = await requestSlackDirectoryPage(
        () =>
          this.callQuery('users.list', usersResponseSchema, {
            limit: '200',
            ...(cursor === null ? {} : { cursor }),
          }),
        startedAt,
        !rateLimitRetryUsed,
      );
      rateLimitRetryUsed ||= page.retried;
      for (const memberValue of page.body.members) {
        const user = slackUserFromDirectoryMember(memberValue);
        if (user !== null) users.push(user);
      }
      cursor = nextSlackDirectoryCursor(page.body.response_metadata.next_cursor, seenCursors);
    } while (cursor !== null);
    return users;
  }

  private call<T extends z.ZodTypeAny>(
    method: string,
    schema: T,
    payload: Record<string, unknown>,
  ): Promise<SuccessfulSlackResponse<T>> {
    return this.request(method, schema, `${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
    });
  }

  private callQuery<T extends z.ZodTypeAny>(
    method: string,
    schema: T,
    payload: Record<string, string>,
  ): Promise<SuccessfulSlackResponse<T>> {
    const url = new URL(`${this.baseUrl}/${method}`);
    for (const [key, value] of Object.entries(payload)) url.searchParams.set(key, value);
    return this.request(method, schema, url, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
    });
  }

  private async request<T extends z.ZodTypeAny>(
    method: string,
    schema: T,
    input: string | URL,
    init: RequestInit,
  ): Promise<SuccessfulSlackResponse<T>> {
    const response = await this.fetchImpl(input, init);
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds =
        retryAfterHeader === null || retryAfterHeader.trim().length === 0
          ? Number.NaN
          : Number(retryAfterHeader);
      const retryAfterMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? Math.ceil(retryAfterSeconds * 1000)
          : undefined;
      throw new SlackApiError(method, 'ratelimited', retryAfterMs);
    }
    if (!response.ok) throw internal(`Slack ${method} returned HTTP ${response.status}.`);

    const parsed = schema.safeParse(await readJson(response, method));
    if (!parsed.success) throw internal(`Slack ${method} returned an unexpected payload.`);
    const body = parsed.data as z.infer<typeof slackResponseSchema>;
    if (!body.ok) throw new SlackApiError(method, body.error ?? 'unknown_error');
    return parsed.data as SuccessfulSlackResponse<T>;
  }
}

async function readJson(response: Response, method: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw internal(`Slack ${method} returned a body that is not json.`, error);
  }
}
