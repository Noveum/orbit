import { notificationProviderPayloadSchema } from '@orbit/shared';
import { escapeSlackText, type PostMessageInput } from './index.ts';

function messageExcerpt(value: string): string {
  const escaped = escapeSlackText(value);
  if (escaped.length <= 1200) return escaped;
  let excerpt = '';
  for (const character of value) {
    const next = escapeSlackText(character);
    if (excerpt.length + next.length > 1199) break;
    excerpt += next;
  }
  return `${excerpt}…`;
}

function messageLinks(url: string, externalUrl: string | null | undefined) {
  const orbit = { label: 'Open in Orbit', url: absoluteNotificationUrl(url) };
  if (externalUrl == null || externalUrl.length === 0) return [orbit];
  const source = absoluteNotificationUrl(externalUrl);
  if (source === orbit.url) return [orbit];
  return [
    orbit,
    {
      label: new URL(source).hostname === 'github.com' ? 'Open on GitHub' : 'View source',
      url: source,
    },
  ];
}

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
  const links = messageLinks(payload.url, payload.externalUrl);
  const title = escapeSlackText(payload.title);
  const body = messageExcerpt(payload.body);
  const text = [title, body, ...links.map((link) => `${link.label}: ${link.url}`)]
    .filter((part) => part.length > 0)
    .join('\n');
  return {
    channel: input.channel,
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          verbatim: true,
          text: `*${title}*${body.length === 0 ? '' : `\n${body}`}`,
        },
      },
      {
        type: 'actions',
        elements: links.map((link) => ({
          type: 'button',
          text: { type: 'plain_text', text: link.label },
          url: link.url,
        })),
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
