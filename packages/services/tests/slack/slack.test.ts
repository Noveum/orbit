import { describe, expect, it } from 'bun:test';
import { DomainError } from '@orbit/shared';
import {
  buildUnfurl,
  commandParser,
  escapeSlackText,
  issueBlocks,
  SlackApiError,
  SlackClient,
  type SlackIssue,
  slashCommandSchema,
  verifySlackSignature,
} from '../../src/slack/index.ts';

const SIGNING_SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const TIMESTAMP = '1531420618';
const BODY =
  'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
const SIGNATURE = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';
const AT = new Date(Number.parseInt(TIMESTAMP, 10) * 1000);

describe('verifySlackSignature', () => {
  it('accepts the documented slack vector', () => {
    expect(verifySlackSignature(BODY, TIMESTAMP, SIGNATURE, SIGNING_SECRET, AT)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySlackSignature(`${BODY}&evil=1`, TIMESTAMP, SIGNATURE, SIGNING_SECRET, AT)).toBe(
      false,
    );
  });

  it('rejects a tampered signature of the same length', () => {
    const tampered = `${SIGNATURE.slice(0, -1)}${SIGNATURE.endsWith('3') ? '4' : '3'}`;
    expect(verifySlackSignature(BODY, TIMESTAMP, tampered, SIGNING_SECRET, AT)).toBe(false);
  });

  it('rejects a replayed timestamp outside the five minute window', () => {
    const late = new Date(AT.getTime() + 301_000);
    expect(verifySlackSignature(BODY, TIMESTAMP, SIGNATURE, SIGNING_SECRET, late)).toBe(false);
    const early = new Date(AT.getTime() - 301_000);
    expect(verifySlackSignature(BODY, TIMESTAMP, SIGNATURE, SIGNING_SECRET, early)).toBe(false);
  });

  it('accepts a timestamp at the edge of the window', () => {
    expect(
      verifySlackSignature(
        BODY,
        TIMESTAMP,
        SIGNATURE,
        SIGNING_SECRET,
        new Date(AT.getTime() + 300_000),
      ),
    ).toBe(true);
  });

  it('rejects a wrong secret, an empty secret and a malformed timestamp', () => {
    expect(verifySlackSignature(BODY, TIMESTAMP, SIGNATURE, 'nope', AT)).toBe(false);
    expect(verifySlackSignature(BODY, TIMESTAMP, SIGNATURE, '', AT)).toBe(false);
    expect(verifySlackSignature(BODY, 'not-a-number', SIGNATURE, SIGNING_SECRET, AT)).toBe(false);
    expect(verifySlackSignature(BODY, TIMESTAMP, '', SIGNING_SECRET, AT)).toBe(false);
    expect(verifySlackSignature(BODY, TIMESTAMP, 'v0=short', SIGNING_SECRET, AT)).toBe(false);
  });
});

const issue: SlackIssue = {
  identifier: 'ORB-42',
  title: 'Fix <the> router & things',
  url: 'https://orbit.local/issue/ORB-42',
  state: 'In Progress',
  priority: 1,
  assigneeName: 'Ada',
  teamName: 'Core',
  description: 'A longer description of the problem.',
};

describe('issueBlocks', () => {
  it('renders linked read-only issue details without actions', () => {
    const blocks = issueBlocks(issue);
    const json = JSON.stringify(blocks);
    expect(json).toContain('https://orbit.local/issue/ORB-42');
    expect(json).toContain('ORB-42');
    expect(json).toContain('In Progress');
    expect(json).toContain('Urgent');
    expect(json).toContain('Ada');
    expect(json).toContain('Core');
    expect(json).not.toContain('orbit_open_issue');
    expect(json).not.toContain('orbit_assign_self');
    expect(json).not.toContain('orbit_mark_done');
    expect(blocks.some((block) => block['type'] === 'actions')).toBe(false);
  });

  it('escapes slack control characters in user content', () => {
    const json = JSON.stringify(issueBlocks(issue));
    expect(json).toContain('Fix &lt;the&gt; router &amp; things');
    expect(escapeSlackText('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('falls back to unassigned and skips an empty description', () => {
    const blocks = issueBlocks({ ...issue, assigneeName: null, description: '   ' });
    const json = JSON.stringify(blocks);
    expect(json).toContain('Unassigned');
    expect(json).not.toContain('context');
  });
});

describe('buildUnfurl', () => {
  it('keys the unfurl by the shared url', () => {
    const unfurl = buildUnfurl(issue.url, issue);
    expect(Object.keys(unfurl)).toEqual([issue.url]);
    expect(unfurl[issue.url]?.blocks.length).toBeGreaterThan(0);
  });
});

describe('SlackClient', () => {
  it('opens a direct message conversation', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = Object.assign(
      (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
      { preconnect: () => undefined },
    );
    const client = new SlackClient({
      token: 'xoxb-test',
      baseUrl: 'https://slack.test/api',
      fetch,
    });

    await expect(client.openConversation('U123')).resolves.toEqual({ channel: 'D123' });
    expect(requests).toEqual([
      { url: 'https://slack.test/api/conversations.open', body: { users: 'U123' } },
    ]);
  });

  it('rejects a successful response without a non-empty conversation id', async () => {
    const fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, channel: { id: '' } }), {
          headers: { 'content-type': 'application/json' },
        }),
      )) as unknown as typeof globalThis.fetch;
    const client = new SlackClient({ token: 'xoxb-test', fetch });

    await expect(client.openConversation('U123')).rejects.toThrow(/unexpected payload/);
  });

  it('preserves Slack errors from a failed conversation response', async () => {
    const fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'users_not_found' }), {
          headers: { 'content-type': 'application/json' },
        }),
      )) as unknown as typeof globalThis.fetch;
    const client = new SlackClient({ token: 'xoxb-test', fetch });

    await expect(client.openConversation('U123')).rejects.toThrow(/users_not_found/);
  });
});

describe('commandParser', () => {
  it('parses new and search', () => {
    expect(commandParser('new Fix the router')).toEqual({ kind: 'new', title: 'Fix the router' });
    expect(commandParser('search flaky tests')).toEqual({ kind: 'search', query: 'flaky tests' });
  });

  it('tolerates the leading slash command, casing and extra spacing', () => {
    expect(commandParser('/orbit  NEW   Ship it  ')).toEqual({ kind: 'new', title: 'Ship it' });
    expect(commandParser('Search  ORB-1')).toEqual({ kind: 'search', query: 'ORB-1' });
  });

  it('unescapes slack entities', () => {
    expect(commandParser('new A &amp; B &lt;x&gt;')).toEqual({
      kind: 'new',
      title: 'A & B <x>',
    });
  });

  it('returns help for empty input and missing arguments', () => {
    expect(commandParser('')).toEqual({ kind: 'help' });
    expect(commandParser('/orbit')).toEqual({ kind: 'help' });
    expect(commandParser('help')).toEqual({ kind: 'help' });
    expect(commandParser('new')).toEqual({ kind: 'help' });
    expect(commandParser('search   ')).toEqual({ kind: 'help' });
  });

  it('reports unknown verbs', () => {
    expect(commandParser('delete everything')).toEqual({
      kind: 'unknown',
      text: 'delete everything',
    });
  });
});

describe('slashCommandSchema', () => {
  it('accepts a slack slash command payload', () => {
    const parsed = slashCommandSchema.parse({
      command: '/orbit',
      text: 'new thing',
      team_id: 'T1',
      channel_id: 'C1',
      user_id: 'U1',
      response_url: 'https://hooks.slack.com/commands/T1/1/abc',
      trigger_id: '1.2.3',
    });
    expect(parsed.text).toBe('new thing');
  });

  it('rejects a payload without a team', () => {
    expect(() =>
      slashCommandSchema.parse({ command: '/orbit', channel_id: 'C1', user_id: 'U1' }),
    ).toThrow();
  });
});

type FetchImpl = typeof globalThis.fetch;
type FetchInput = Parameters<FetchImpl>[0];
type FetchInit = Parameters<FetchImpl>[1];

function asFetchImpl(send: (input: FetchInput, init: FetchInit) => Promise<Response>): FetchImpl {
  return Object.assign(send, { preconnect: globalThis.fetch.preconnect });
}

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: FetchInit }[] = [];
  const impl = asFetchImpl((input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return { impl, calls };
}

describe('SlackClient', () => {
  it('requires a token', () => {
    expect(() => new SlackClient({ token: '' })).toThrow(DomainError);
  });

  it('posts a message and returns the timestamp', async () => {
    const { impl, calls } = stubFetch(200, { ok: true, ts: '1700000000.000100', channel: 'C1' });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    const result = await client.postMessage({
      channel: 'C1',
      text: 'hello',
      blocks: issueBlocks(issue),
    });
    expect(result).toEqual({ channel: 'C1', ts: '1700000000.000100' });
    expect(calls[0]?.url).toBe('https://slack.com/api/chat.postMessage');
    expect(String(calls[0]?.init?.body)).toContain('"channel":"C1"');
  });

  it('updates a message', async () => {
    const { impl, calls } = stubFetch(200, { ok: true, ts: '1.1', channel: 'C1' });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    const result = await client.updateMessage({ channel: 'C1', ts: '1.1', text: 'edited' });
    expect(result.ts).toBe('1.1');
    expect(calls[0]?.url).toBe('https://slack.com/api/chat.update');
  });

  it('opens a view', async () => {
    const { impl, calls } = stubFetch(200, { ok: true, view: { id: 'V1' } });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    expect(await client.openView('trig', { type: 'modal' })).toBe('V1');
    expect(calls[0]?.url).toBe('https://slack.com/api/views.open');
  });

  it('lists conversations and maps the cursor', async () => {
    const { impl } = stubFetch(200, {
      ok: true,
      channels: [
        { id: 'C1', name: 'general', is_private: false, is_member: true },
        { id: 'C2', name: 'announcements', is_private: false, is_member: false },
      ],
      response_metadata: { next_cursor: 'abc' },
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    const result = await client.listConversations();
    expect(result.channels).toEqual([
      { id: 'C1', name: 'general', isPrivate: false, isArchived: false, isMember: true },
      {
        id: 'C2',
        name: 'announcements',
        isPrivate: false,
        isArchived: false,
        isMember: false,
      },
    ]);
    expect(result.nextCursor).toBe('abc');
  });

  it('loads canonical channel metadata and membership', async () => {
    const { impl, calls } = stubFetch(200, {
      ok: true,
      channel: {
        id: 'C-CANONICAL',
        name: 'canonical-name',
        is_private: true,
        is_archived: false,
        is_member: true,
      },
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.conversation('C-REQUESTED')).resolves.toEqual({
      id: 'C-CANONICAL',
      name: 'canonical-name',
      isPrivate: true,
      isArchived: false,
      isMember: true,
    });
    expect(calls[0]?.url).toBe('https://slack.com/api/conversations.info?channel=C-REQUESTED');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('rejects incomplete canonical channel metadata', async () => {
    const { impl } = stubFetch(200, {
      ok: true,
      channel: { id: 'C-CANONICAL', name: 'canonical-name' },
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.conversation('C-REQUESTED')).rejects.toThrow(/unexpected payload/);
  });

  it('preserves an inaccessible channel as a Slack provider error', async () => {
    const { impl } = stubFetch(200, { ok: false, error: 'channel_not_found' });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    try {
      await client.conversation('C-INACCESSIBLE');
      throw new Error('Expected an inaccessible Slack channel to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(SlackApiError);
      expect((error as SlackApiError).code).toBe('channel_not_found');
    }
  });

  it('lists every active human Slack user across pages', async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const impl = asFetchImpl((input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('cursor=next-page')) {
        return Promise.resolve(
          Response.json({
            ok: true,
            members: [
              {
                id: 'U2',
                deleted: false,
                is_bot: false,
                real_name: 'Grace Hopper',
                profile: { email: ' GRACE@EXAMPLE.COM ', display_name: '' },
              },
              {
                id: 'U-DELETED',
                deleted: true,
                is_bot: false,
                is_app_user: false,
                real_name: 'Former User',
                profile: { email: 'former@example.com', display_name: 'Former' },
              },
              {
                id: 'U-APP',
                deleted: false,
                is_bot: false,
                is_app_user: true,
                real_name: 'App User',
                profile: { email: 'app@example.com', display_name: 'App' },
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          ok: true,
          members: [
            {
              id: 'U1',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'Ada Lovelace',
              profile: { email: 'ADA@example.com', display_name: 'ada' },
            },
            {
              id: 'U-BOT',
              deleted: false,
              is_bot: true,
              is_app_user: false,
              real_name: 'Build Bot',
              profile: { email: 'bot@example.com', display_name: 'Build' },
            },
            {
              id: 'U-GUEST',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              is_restricted: true,
              real_name: 'Workspace Guest',
              profile: { email: 'guest@example.com', display_name: 'Guest' },
            },
            {
              id: 'U-NO-EMAIL',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'No Email',
              profile: { display_name: 'Mystery' },
            },
            {
              id: 'U-NULL-EMAIL',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'Null Email',
              profile: { email: null, display_name: 'Null' },
            },
            {
              id: 'U-BAD-EMAIL',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'Bad Email',
              profile: { email: 'not-an-email', display_name: 'Bad' },
            },
            {
              id: 'U-SPARSE',
              is_bot: false,
              real_name: 'Sparse User',
              profile: { email: 'sparse@example.com', display_name: 'Sparse' },
            },
            {
              id: 'U-UNCLASSIFIED',
              deleted: false,
              real_name: 'Unclassified User',
              profile: { email: 'unclassified@example.com', display_name: 'Unclassified' },
            },
            {
              id: 'U-NULL-PROFILE',
              deleted: false,
              is_bot: false,
              profile: null,
            },
          ],
          response_metadata: { next_cursor: 'next-page' },
        }),
      );
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.listUsers()).resolves.toEqual([
      { id: 'U1', email: 'ada@example.com', displayName: 'ada' },
      { id: 'U-GUEST', email: 'guest@example.com', displayName: 'Guest' },
      { id: 'U-SPARSE', email: 'sparse@example.com', displayName: 'Sparse' },
      { id: 'U2', email: 'grace@example.com', displayName: 'Grace Hopper' },
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      'https://slack.com/api/users.list?limit=200',
      'https://slack.com/api/users.list?limit=200&cursor=next-page',
    ]);
    expect(calls.every((call) => call.init?.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.init?.body === undefined)).toBe(true);
  });

  it('skips structurally malformed Slack members while retaining valid members', async () => {
    const { impl } = stubFetch(200, {
      ok: true,
      members: [
        {
          id: 'U1',
          deleted: false,
          is_bot: false,
          profile: { email: 'ada@example.com', display_name: 'Ada' },
        },
        null,
        {
          id: 42,
          deleted: false,
          is_bot: false,
          profile: { email: 'wrong-id@example.com', display_name: 'Wrong Id' },
        },
        {
          id: 'U-BROKEN-PROFILE',
          deleted: false,
          is_bot: false,
          profile: 'not-an-object',
        },
        {
          id: 'U2',
          deleted: false,
          is_bot: false,
          profile: { email: 'grace@example.com', display_name: 'Grace' },
        },
      ],
      response_metadata: { next_cursor: '' },
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.listUsers()).resolves.toEqual([
      { id: 'U1', email: 'ada@example.com', displayName: 'Ada' },
      { id: 'U2', email: 'grace@example.com', displayName: 'Grace' },
    ]);
  });

  it('returns a null cursor when slack sends an empty one', async () => {
    const { impl } = stubFetch(200, { ok: true, channels: [], response_metadata: {} });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    expect((await client.listConversations()).nextCursor).toBeNull();
  });

  it('rejects a repeated Slack user cursor instead of looping', async () => {
    let calls = 0;
    const impl = asFetchImpl(() => {
      calls += 1;
      return Promise.resolve(
        Response.json({
          ok: true,
          members: [],
          response_metadata: { next_cursor: 'repeat-me' },
        }),
      );
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.listUsers()).rejects.toThrow('repeated cursor');
    expect(calls).toBe(2);
  });

  it('bounds a Slack directory with endlessly unique cursors by elapsed time', async () => {
    let calls = 0;
    let now = 0;
    const realDateNow = Date.now;
    Date.now = () => now;
    const impl = asFetchImpl(() => {
      calls += 1;
      now += 15_001;
      return Promise.resolve(
        Response.json({
          ok: true,
          members: [],
          response_metadata: { next_cursor: `cursor-${calls}` },
        }),
      );
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    try {
      await expect(client.listUsers()).rejects.toThrow('safe duration limit');
      expect(calls).toBe(2);
    } finally {
      Date.now = realDateNow;
    }
  });

  it('stops before requesting a page beyond the configured directory page limit', async () => {
    let calls = 0;
    const impl = asFetchImpl(() => {
      calls += 1;
      return Promise.resolve(
        Response.json({
          ok: true,
          members: [],
          response_metadata: { next_cursor: calls < 3 ? `cursor-${calls}` : '' },
        }),
      );
    });
    const client = new SlackClient({
      token: 'xoxb-test',
      fetch: impl,
      userDirectoryPageLimit: 2,
    });

    await expect(client.listUsers()).rejects.toThrow('safe page limit');
    expect(calls).toBe(2);
  });

  it('retries one rate-limited page in the middle of a Slack directory', async () => {
    const urls: string[] = [];
    let calls = 0;
    const impl = asFetchImpl((input) => {
      calls += 1;
      urls.push(String(input));
      if (calls === 1) {
        return Promise.resolve(
          Response.json({
            ok: true,
            members: [
              {
                id: 'U1',
                deleted: false,
                is_bot: false,
                profile: { email: 'ada@example.com', display_name: 'Ada' },
              },
            ],
            response_metadata: { next_cursor: 'next-page' },
          }),
        );
      }
      if (calls === 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          ok: true,
          members: [
            {
              id: 'U2',
              deleted: false,
              is_bot: false,
              profile: { email: 'grace@example.com', display_name: 'Grace' },
            },
          ],
          response_metadata: { next_cursor: '' },
        }),
      );
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.listUsers()).resolves.toEqual([
      { id: 'U1', email: 'ada@example.com', displayName: 'Ada' },
      { id: 'U2', email: 'grace@example.com', displayName: 'Grace' },
    ]);
    expect(urls).toEqual([
      'https://slack.com/api/users.list?limit=200',
      'https://slack.com/api/users.list?limit=200&cursor=next-page',
      'https://slack.com/api/users.list?limit=200&cursor=next-page',
    ]);
  });

  it('allows only one rate-limit retry for an entire Slack directory', async () => {
    let calls = 0;
    const impl = asFetchImpl(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          Response.json({
            ok: true,
            members: [],
            response_metadata: { next_cursor: 'next-page' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        }),
      );
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.listUsers()).rejects.toMatchObject({ code: 'ratelimited' });
    expect(calls).toBe(3);
  });

  it('does not retry a rate limit beyond the Slack directory time budget', async () => {
    let calls = 0;
    const impl = asFetchImpl(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          Response.json({
            ok: true,
            members: [],
            response_metadata: { next_cursor: 'next-page' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '31' },
        }),
      );
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.listUsers()).rejects.toMatchObject({ code: 'ratelimited' });
    expect(calls).toBe(2);
  });

  it('does not retry a rate limit without Retry-After guidance', async () => {
    let calls = 0;
    const impl = asFetchImpl(() => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    await expect(client.listUsers()).rejects.toMatchObject({
      code: 'ratelimited',
      retryAfterMs: undefined,
    });
    expect(calls).toBe(1);
  });

  it('rejects incomplete successful Slack directory pages', async () => {
    const payloads = [{ ok: true }, { ok: true, members: [] }];

    for (const payload of payloads) {
      const client = new SlackClient({ token: 'xoxb-test', fetch: stubFetch(200, payload).impl });
      await expect(client.listUsers()).rejects.toThrow('unexpected payload');
    }
  });

  it('keeps Slack directory errors distinguishable from incomplete successes', async () => {
    const client = new SlackClient({
      token: 'xoxb-test',
      fetch: stubFetch(200, { ok: false, error: 'invalid_auth' }).impl,
    });

    await expect(client.listUsers()).rejects.toMatchObject({ code: 'invalid_auth' });
  });

  it('throws on a slack level error', async () => {
    const { impl } = stubFetch(200, { ok: false, error: 'channel_not_found' });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    await expect(client.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(
      /channel_not_found/,
    );
  });

  it('maps HTTP failures to domain errors', async () => {
    const broken = new SlackClient({ token: 'xoxb-test', fetch: stubFetch(500, {}).impl });
    await expect(broken.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(/HTTP 500/);
  });

  it('preserves Slack Retry-After timing on a rate limit', async () => {
    const impl = asFetchImpl(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '90' },
        }),
      ),
    );
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });

    let caught: unknown;
    try {
      await client.postMessage({ channel: 'C1', text: 'hi' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SlackApiError);
    if (!(caught instanceof SlackApiError)) throw new Error('Expected a Slack API error.');
    expect(caught.code).toBe('ratelimited');
    expect(caught.retryAfterMs).toBe(90_000);
  });

  it('rejects a body that is not json', async () => {
    const impl = asFetchImpl(() =>
      Promise.resolve(new Response('<html>nope</html>', { status: 200 })),
    );
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    await expect(client.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(/not json/);
  });

  it('rejects an unexpected payload shape', async () => {
    const { impl } = stubFetch(200, { ok: 'yes' });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    await expect(client.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(
      /unexpected payload/,
    );
  });
});
