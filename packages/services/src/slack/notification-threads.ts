import { notificationProviderPayloadSchema } from '@orbit/shared';
import { renderPlainText } from '../markdown/index.ts';
import { escapeSlackText, type PostMessageInput } from './index.ts';

function messageExcerpt(value: string, format: 'markdown' | 'plain_text'): string {
  const bounded = value.slice(0, 4000).replace(/[\uD800-\uDBFF]$/u, '');
  const lines = (format === 'plain_text' ? bounded : renderPlainText(bounded))
    .split(/\n+/)
    .filter((line) => line.trim().length > 0);
  const preview = [lines[0] ?? '', lines.slice(1).join(' ')].filter(Boolean).join('\n');
  const omitted = value.length > 4000;
  const escaped = escapeSlackText(preview);
  if (escaped.length <= 400) return `${escaped}${omitted ? '…' : ''}`;
  let excerpt = '';
  for (const character of preview) {
    const next = escapeSlackText(character);
    if (excerpt.length + next.length > 399) break;
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
  const body = messageExcerpt(payload.body, payload.bodyFormat);
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
    ],
    ...(input.rootTs === null ? {} : { threadTs: input.rootTs }),
    replyBroadcast: false,
    unfurlLinks: false,
  };
}
