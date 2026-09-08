import { notificationProviderPayloadSchema } from '@orbit/shared';
import { escapeSlackText, type PostMessageInput } from './index.ts';

export function absoluteNotificationUrl(url: string): string {
  const base = process.env['NEXT_PUBLIC_APP_URL'] ?? process.env['APP_URL'];
  const parsed = new URL(url, base);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Notification links must use HTTP or HTTPS.');
  }
  return parsed.toString();
}

export function notificationSlackMessage(input: {
  readonly channel: string;
  readonly rootTs: string | null;
  readonly payload: unknown;
}): PostMessageInput {
  const payload = notificationProviderPayloadSchema.parse(input.payload);
  const url = absoluteNotificationUrl(payload.externalUrl ?? payload.url);
  const title = escapeSlackText(payload.title);
  const body = escapeSlackText(payload.body).slice(0, 1200);
  const text = `${title}\n${body}\n${url}`;
  return {
    channel: input.channel,
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${title}*${body.length === 0 ? '' : `\n${body}`}` },
      },
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open update' }, url }],
      },
      ...(input.rootTs === null
        ? [
            {
              type: 'context',
              elements: [
                {
                  type: 'plain_text',
                  text: 'Later updates to this conversation appear in this thread.',
                },
              ],
            },
          ]
        : []),
    ],
    ...(input.rootTs === null ? {} : { threadTs: input.rootTs }),
    replyBroadcast: false,
    unfurlLinks: false,
  };
}
