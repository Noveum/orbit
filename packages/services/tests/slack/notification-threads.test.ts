import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
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
