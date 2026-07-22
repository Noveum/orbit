import { DomainError } from '@orbit/shared';
import { describe, expect, it } from 'vitest';
import {
  buildUnfurl,
  commandParser,
  escapeSlackText,
  issueBlocks,
  SlackClient,
  type SlackIssue,
  slashCommandSchema,
  verifySlackSignature,
} from './index.ts';

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
  it('renders identifier, title, status, priority, assignee and buttons', () => {
    const blocks = issueBlocks(issue);
    const json = JSON.stringify(blocks);
    expect(json).toContain('https://orbit.local/issue/ORB-42');
    expect(json).toContain('ORB-42');
    expect(json).toContain('In Progress');
    expect(json).toContain('Urgent');
    expect(json).toContain('Ada');
    expect(json).toContain('Core');
    expect(json).toContain('orbit_assign_self');
    expect(json).toContain('orbit_mark_done');
    expect(blocks.at(-1)?.['type']).toBe('actions');
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

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: typeof globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
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
      channels: [{ id: 'C1', name: 'general', is_private: false }],
      response_metadata: { next_cursor: 'abc' },
    });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    const result = await client.listConversations();
    expect(result.channels).toEqual([
      { id: 'C1', name: 'general', isPrivate: false, isArchived: false },
    ]);
    expect(result.nextCursor).toBe('abc');
  });

  it('returns a null cursor when slack sends an empty one', async () => {
    const { impl } = stubFetch(200, { ok: true, channels: [], response_metadata: {} });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    expect((await client.listConversations()).nextCursor).toBeNull();
  });

  it('throws on a slack level error', async () => {
    const { impl } = stubFetch(200, { ok: false, error: 'channel_not_found' });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    await expect(client.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(
      /channel_not_found/,
    );
  });

  it('maps rate limiting and http failures to domain errors', async () => {
    const limited = new SlackClient({ token: 'xoxb-test', fetch: stubFetch(429, {}).impl });
    await expect(limited.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(DomainError);

    const broken = new SlackClient({ token: 'xoxb-test', fetch: stubFetch(500, {}).impl });
    await expect(broken.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(/HTTP 500/);
  });

  it('rejects an unexpected payload shape', async () => {
    const { impl } = stubFetch(200, { ok: 'yes' });
    const client = new SlackClient({ token: 'xoxb-test', fetch: impl });
    await expect(client.postMessage({ channel: 'C1', text: 'hi' })).rejects.toThrow(
      /unexpected payload/,
    );
  });
});
