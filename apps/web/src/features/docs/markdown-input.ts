export interface Selection {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export interface EditResult {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export function wrapSelection(selection: Selection, marker: string): EditResult {
  const { value, start, end } = selection;
  const before = value.slice(0, start);
  const inner = value.slice(start, end);
  const after = value.slice(end);

  if (
    inner.length > 0 &&
    inner.startsWith(marker) &&
    inner.endsWith(marker) &&
    inner.length >= marker.length * 2
  ) {
    const stripped = inner.slice(marker.length, inner.length - marker.length);
    return { value: `${before}${stripped}${after}`, start, end: start + stripped.length };
  }

  const next = `${before}${marker}${inner}${marker}${after}`;
  return {
    value: next,
    start: start + marker.length,
    end: start + marker.length + inner.length,
  };
}

export function linkSelection(selection: Selection, url = 'https://'): EditResult {
  const { value, start, end } = selection;
  const label = value.slice(start, end);
  const text = label.length === 0 ? 'link' : label;
  const inserted = `[${text}](${url})`;
  return {
    value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
    start: start + text.length + 3,
    end: start + text.length + 3 + url.length,
  };
}

export function insertBlock(selection: Selection, block: string): EditResult {
  const { value, start, end } = selection;
  const before = value.slice(0, start);
  const needsBreak = before.length > 0 && !before.endsWith('\n');
  const prefix = needsBreak ? '\n\n' : '';
  const inserted = `${prefix}${block}`;
  return {
    value: `${before}${inserted}${value.slice(end)}`,
    start: start + inserted.length,
    end: start + inserted.length,
  };
}

export function replaceSlashQuery(selection: Selection, block: string): EditResult {
  const { value, start } = selection;
  const before = value.slice(0, start);
  const slash = before.lastIndexOf('/');
  if (slash === -1) return insertBlock(selection, block);
  const stripped = { value: before.slice(0, slash) + value.slice(start), start: slash, end: slash };
  return insertBlock(stripped, block);
}

export const SNIPPETS = {
  heading: '## Heading\n\n',
  table: '| Column | Column |\n| --- | --- |\n| Value | Value |\n\n',
  code: '```ts\ncode here\n```\n\n',
  tasks: '- [ ] First task\n- [ ] Second task\n\n',
} as const;

export type SnippetName = keyof typeof SNIPPETS;

export function attachmentMarkdown(fileName: string, contentType: string, url: string): string {
  return contentType.startsWith('image/') ? `![${fileName}](${url})` : `[${fileName}](${url})`;
}
