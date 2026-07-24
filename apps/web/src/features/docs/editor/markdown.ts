import type { JSONContent } from '@tiptap/core';

export const CALLOUT_TONES = ['note', 'tip', 'warning', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export const CALLOUT_LABEL: Record<CalloutTone, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
};

const BLOCK_START = /^(#{1,6}\s|>|-\s|\+\s|\d+[.)]\s|\||```|---|===)/;
const LABEL_TO_TONE = new Map<string, CalloutTone>(
  CALLOUT_TONES.map((tone) => [CALLOUT_LABEL[tone].toLowerCase(), tone]),
);

export function calloutToneOf(label: string): CalloutTone | null {
  return LABEL_TO_TONE.get(label.trim().toLowerCase()) ?? null;
}

function attr(node: JSONContent, name: string): unknown {
  return node.attrs === undefined ? undefined : node.attrs[name];
}

function stringAttr(node: JSONContent, name: string, fallback = ''): string {
  const value = attr(node, name);
  return typeof value === 'string' ? value : fallback;
}

function numberAttr(node: JSONContent, name: string, fallback: number): number {
  const value = attr(node, name);
  return typeof value === 'number' ? value : fallback;
}

function escapeInline(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*`[\]])/g, '\\$1')
    .replace(/(^|\s)_/g, '$1\\_')
    .replace(/_(\s|$)/g, '\\_$1')
    .replace(/<(?=[a-zA-Z/!?])/g, '\\<');
}

function markName(mark: { type?: string }): string {
  return mark.type ?? '';
}

function applyMarks(text: string, node: JSONContent): string {
  const marks = node.marks ?? [];
  let value = text;
  if (marks.some((mark) => markName(mark) === 'code')) value = `\`${text}\``;
  if (marks.some((mark) => markName(mark) === 'bold')) value = `**${value}**`;
  if (marks.some((mark) => markName(mark) === 'italic')) value = `_${value}_`;
  if (marks.some((mark) => markName(mark) === 'strike')) value = `~~${value}~~`;

  const link = marks.find((mark) => markName(mark) === 'link');
  if (link !== undefined) {
    const href = link.attrs === undefined ? '' : link.attrs['href'];
    value = `[${value}](${typeof href === 'string' ? href : ''})`;
  }
  return value;
}

function inlineOf(nodes: readonly JSONContent[] | undefined): string {
  if (nodes === undefined) return '';
  let out = '';
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      out += '\\\n';
      continue;
    }
    if (node.type === 'image') {
      out += `![${stringAttr(node, 'alt')}](${stringAttr(node, 'src')})`;
      continue;
    }
    if (node.type === 'mention') {
      out += `@${stringAttr(node, 'id', stringAttr(node, 'label'))}`;
      continue;
    }
    if (node.text === undefined) {
      out += inlineOf(node.content);
      continue;
    }
    const marks = node.marks ?? [];
    const raw = marks.some((mark) => markName(mark) === 'code')
      ? node.text
      : escapeInline(node.text);
    out += applyMarks(raw, node);
  }
  return out;
}

function guardBlockStart(text: string): string {
  return BLOCK_START.test(text) ? `\\${text}` : text;
}

function prefixLines(text: string, prefix: string, continuation = prefix): string {
  const lines = text.split('\n');
  return lines
    .map((line, index) => {
      const marker = index === 0 ? prefix : continuation;
      return line.length === 0 ? marker.trimEnd() : `${marker}${line}`;
    })
    .join('\n');
}

function cellText(node: JSONContent): string {
  return inlineOf(node.content?.flatMap((child) => child.content ?? []))
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

function tableOf(node: JSONContent): string {
  const rows = node.content ?? [];
  const grid = rows.map((row) => (row.content ?? []).map(cellText));
  const header = grid[0] ?? [];
  if (header.length === 0) return '';
  const divider = header.map(() => '---');
  const body = grid.slice(1);
  const lines = [`| ${header.join(' | ')} |`, `| ${divider.join(' | ')} |`];
  for (const row of body) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

function listOf(node: JSONContent, kind: 'bullet' | 'ordered' | 'task'): string {
  const items = node.content ?? [];
  const start = numberAttr(node, 'start', 1);
  return items
    .map((item, index) => {
      const body = blocksOf(item.content, '\n\n');
      if (kind === 'ordered') return prefixLines(body, `${start + index}. `, '   ');
      if (kind === 'task') {
        const checked = attr(item, 'checked') === true;
        return prefixLines(body, checked ? '- [x] ' : '- [ ] ', '  ');
      }
      return prefixLines(body, '- ', '  ');
    })
    .join('\n');
}

function blockOf(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return guardBlockStart(inlineOf(node.content));
    case 'heading': {
      const level = Math.min(6, Math.max(1, numberAttr(node, 'level', 1)));
      return `${'#'.repeat(level)} ${inlineOf(node.content)}`;
    }
    case 'codeBlock': {
      const language = stringAttr(node, 'language');
      const text = (node.content ?? [])
        .map((child) => child.text ?? '')
        .join('')
        .replace(/\n+$/, '');
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    case 'image':
      return `![${stringAttr(node, 'alt')}](${stringAttr(node, 'src')})`;
    case 'blockquote':
      return prefixLines(blocksOf(node.content, '\n\n'), '> ');
    case 'callout': {
      const toneValue = stringAttr(node, 'tone', 'note');
      const tone = CALLOUT_TONES.includes(toneValue as CalloutTone)
        ? (toneValue as CalloutTone)
        : 'note';
      const body = blocksOf(node.content, '\n\n');
      return prefixLines(`**${CALLOUT_LABEL[tone]}**\n${body}`, '> ');
    }
    case 'bulletList':
      return listOf(node, 'bullet');
    case 'orderedList':
      return listOf(node, 'ordered');
    case 'taskList':
      return listOf(node, 'task');
    case 'table':
      return tableOf(node);
    case 'toggleBlock': {
      const [summary, ...rest] = node.content ?? [];
      const title = summary === undefined ? '' : inlineOf(summary.content);
      const body = blocksOf(rest, '\n\n');
      return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
    }
    default:
      return blocksOf(node.content, '\n\n');
  }
}

function blocksOf(nodes: readonly JSONContent[] | undefined, separator: string): string {
  if (nodes === undefined) return '';
  return nodes
    .map(blockOf)
    .filter((block) => block.length > 0)
    .join(separator);
}

export function docToMarkdown(doc: JSONContent): string {
  return `${blocksOf(doc.content, '\n\n')}\n`.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}
