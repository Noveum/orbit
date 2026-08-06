import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
]);

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ESCAPES.get(character) ?? character);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function tokenClasses(properties: unknown): string {
  if (!isRecord(properties)) return '';
  const names = properties['className'];
  if (typeof names === 'string') return names;
  if (!Array.isArray(names)) return '';
  return names.filter((entry): entry is string => typeof entry === 'string').join(' ');
}

function serializeTokens(node: unknown): string {
  if (!isRecord(node)) return '';
  if (node['type'] === 'text') {
    const value = node['value'];
    return typeof value === 'string' ? escapeHtml(value) : '';
  }
  const children = node['children'];
  const inner = Array.isArray(children) ? children.map(serializeTokens).join('') : '';
  if (node['type'] !== 'element' || node['tagName'] !== 'span') return inner;
  const classes = tokenClasses(node['properties']);
  return classes.length === 0 ? inner : `<span class="${escapeHtml(classes)}">${inner}</span>`;
}

export function languageAlias(raw: string): string {
  const first = raw.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return first.replace(/^language-/, '');
}

export function highlightCode(source: string, language: string): string {
  const alias = languageAlias(language);
  if (alias.length === 0 || !lowlight.registered(alias)) return escapeHtml(source);
  try {
    return serializeTokens(lowlight.highlight(alias, source));
  } catch {
    return escapeHtml(source);
  }
}
