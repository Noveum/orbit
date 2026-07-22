import { SORT_ORDER_STEP } from '../constants/index.ts';

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function issueIdentifier(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

export function parseIssueIdentifier(value: string): { prefix: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/.exec(value.trim());
  if (!match) return null;
  const [, prefix, digits] = match;
  if (prefix === undefined || digits === undefined) return null;
  const number = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { prefix: prefix.toUpperCase(), number };
}

export function branchName(params: {
  username: string;
  identifier: string;
  title: string;
}): string {
  const user = slugify(params.username) || 'orbit';
  const title = slugify(params.title).slice(0, 48).replace(/-+$/, '');
  const id = params.identifier.toLowerCase();
  return title.length > 0 ? `${user}/${id}-${title}` : `${user}/${id}`;
}

export function sortOrderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return SORT_ORDER_STEP;
  if (before === null && after !== null) return after - SORT_ORDER_STEP;
  if (before !== null && after === null) return before + SORT_ORDER_STEP;
  if (before !== null && after !== null) return (before + after) / 2;
  return SORT_ORDER_STEP;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

export function extractMentions(markdown: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:^|[\s(])@([a-z0-9][a-z0-9._-]{1,38})/gi;
  let match = pattern.exec(markdown);
  while (match !== null) {
    const handle = match[1];
    if (handle !== undefined) found.add(handle.toLowerCase());
    match = pattern.exec(markdown);
  }
  return [...found];
}

export function extractIssueIdentifiers(text: string): string[] {
  const found = new Set<string>();
  const pattern = /\b([A-Z][A-Z0-9]{1,5}-\d+)\b/g;
  let match = pattern.exec(text.toUpperCase());
  while (match !== null) {
    const id = match[1];
    if (id !== undefined) found.add(id);
    match = pattern.exec(text.toUpperCase());
  }
  return [...found];
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = units[unitIndex] ?? 'KB';
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function groupBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K,
): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const group = key(item);
    const bucket = result.get(group);
    if (bucket === undefined) result.set(group, [item]);
    else bucket.push(item);
  }
  return result;
}

export function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError('chunk size must be positive');
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function relativeTime(from: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - from.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
