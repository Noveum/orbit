import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  absoluteNotificationUrl,
  notificationSlackMessage,
} from '../../src/slack/notification-threads.ts';

const previous = {
  APP_URL: process.env['APP_URL'],
  NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
};
beforeAll(() => {
  process.env['APP_URL'] = 'https://orbit.example.com';
  delete process.env['NEXT_PUBLIC_APP_URL'];
});
afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('notification Slack messages', () => {
  it('keeps comment previews short and readable without raw Markdown or HTML', () => {
    const message = notificationSlackMessage({
      channel: 'C-test',
      rootTs: '1.000',
      payload: {
        title: 'New comment from Sam',
        body: `**Type check** failed.\n\n<details><summary>Details</summary>Missing an export.</details>\n\n${'More context '.repeat(100)}`,
        url: '/inbox',
      },
    });
    const section = z.object({ text: z.object({ text: z.string() }) }).parse(message.blocks?.[0]);
    expect(section.text.text).toContain('Type check failed.');
    expect(section.text.text).not.toContain('<details>');
    expect(section.text.text).not.toContain('&lt;details&gt;');
    expect(section.text.text).not.toContain('**Type check**');
    expect(section.text.text.length).toBeLessThanOrEqual(450);
    expect(section.text.text).toEndWith('…');
  });

  it('disables automatic mention parsing for ordinary workspace mention text', () => {
    const message = notificationSlackMessage({
      channel: 'C-test',
      rootTs: null,
      payload: {
        title: 'Check @here',
        body: '@everyone @channel <@U123> & details',
        url: '/inbox',
      },
    });
    const section = z
      .object({ text: z.object({ text: z.string(), verbatim: z.boolean() }) })
      .parse(message.blocks?.[0]);
    expect(section.text.verbatim).toBe(true);
    expect(section.text.text).toContain('&lt;@U123&gt; &amp; details');
  });

  it('keeps canonical Orbit and GitHub destinations in buttons and accessible fallback', () => {
    const message = notificationSlackMessage({
      channel: 'C-test',
      rootTs: null,
      payload: {
        title: 'Review submitted',
        body: 'Ready to merge',
        url: '/issue/ORB-42#comment-12',
        externalUrl: 'https://github.com/Noveum/orbit/pull/383#discussion_r42',
      },
    });
    const actions = z
      .object({
        elements: z.array(z.object({ url: z.string(), text: z.object({ text: z.string() }) })),
      })
      .parse(message.blocks?.[1]);
    expect(actions.elements.map((button) => button.text.text)).toEqual([
      'Open in Orbit',
      'Open on GitHub',
    ]);
    expect(actions.elements.map((button) => button.url)).toEqual([
      'https://orbit.example.com/issue/ORB-42#comment-12',
      'https://github.com/Noveum/orbit/pull/383#discussion_r42',
    ]);
    for (const button of actions.elements) expect(message.text).toContain(button.url);
  });

  it('truncates without splitting escaped entities or Unicode code points', () => {
    for (const body of [
      `${'x'.repeat(1198)}& more`,
      `${'x'.repeat(1199)}🙂`,
      `${' '.repeat(3999)}🙂`,
    ]) {
      const message = notificationSlackMessage({
        channel: 'C-test',
        rootTs: null,
        payload: { title: 'T', body, url: '/inbox' },
      });
      const section = z.object({ text: z.object({ text: z.string() }) }).parse(message.blocks?.[0]);
      expect(section.text.text).toEndWith('…');
      expect(section.text.text).not.toMatch(/&(?:a|am|amp)?…$/);
      expect(section.text.text).not.toMatch(/[\uD800-\uDBFF]…$/u);
      expect(section.text.text).not.toContain('\uFFFD');
      expect(section.text.text.length).toBeLessThanOrEqual(1204);
    }
  });

  it('bounds sections without repetitive footers or broadcasting replies', () => {
    const payload = { title: '&'.repeat(255), body: '<'.repeat(100_000), url: '/inbox' };
    const root = notificationSlackMessage({ channel: 'C-test', rootTs: null, payload });
    const reply = notificationSlackMessage({ channel: 'C-test', rootTs: '1.000', payload });
    const section = z.object({ text: z.object({ text: z.string() }) }).parse(root.blocks?.[0]);
    expect(section.text.text.length).toBeLessThanOrEqual(3000);
    expect(root.blocks).toHaveLength(2);
    expect(root.threadTs).toBeUndefined();
    expect(reply.blocks).toHaveLength(2);
    expect(reply.threadTs).toBe('1.000');
    expect(reply.replyBroadcast).toBe(false);
    expect(reply.unfurlLinks).toBe(false);
  });
  it('keeps content accessible and escapes Slack-wide mentions', () => {
    const message = notificationSlackMessage({
      channel: 'C-test',
      rootTs: '1.000',
      payload: { title: 'Review <!channel>', body: 'A & B changed', url: '/inbox' },
    });
    expect(message.text).toContain('Review &lt;!channel&gt;');
    expect(message.text).toContain('https://orbit.example.com/inbox');
    expect(message.threadTs).toBe('1.000');
    expect(message.replyBroadcast).toBe(false);
  });

  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///private/test']) {
    it(`rejects unsafe link scheme ${url.split(':')[0]}`, () => {
      expect(() => absoluteNotificationUrl(url)).toThrow();
    });
  }
});
