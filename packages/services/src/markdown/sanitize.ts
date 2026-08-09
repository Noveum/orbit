import { parseHTML } from 'linkedom';

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'del',
  'u',
  'mark',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'input',
  'span',
  'sup',
  'sub',
  'details',
  'summary',
  'div',
  'figure',
  'figcaption',
]);

const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'template',
  'textarea',
  'title',
  'noscript',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  'frame',
  'frameset',
  'applet',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'portal',
  'dialog',
  'slot',
]);

const ALLOWED_ATTR = new Set([
  'href',
  'src',
  'alt',
  'title',
  'class',
  'align',
  'type',
  'checked',
  'disabled',
  'colspan',
  'rowspan',
  'start',
  'width',
  'height',
  'target',
  'rel',
  'open',
]);

const IMAGE_DEFAULTS: readonly (readonly [string, string])[] = [
  ['loading', 'lazy'],
  ['decoding', 'async'],
];

const URL_ATTR = new Set(['href', 'src']);
const ABSOLUTE_URL = /^(?:https?:)?\/\//i;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);
const ENTITY = /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g;
const NAMED_ENTITIES = new Map([
  ['colon', ':'],
  ['semi', ';'],
  ['sol', '/'],
  ['quest', '?'],
  ['num', '#'],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['tab', '\t'],
  ['newline', '\n'],
  ['nbsp', '\u00a0'],
]);

const IGNORED_CODE_POINTS = new Set([
  0x00a0, 0x1680, 0x180e, 0x2028, 0x2029, 0x202f, 0x205f, 0x2060, 0x3000, 0xfeff,
]);

export function decodeEntities(value: string): string {
  return value.replace(ENTITY, (match, body: string) => {
    if (!body.startsWith('#')) return NAMED_ENTITIES.get(body.toLowerCase()) ?? match;
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
    if (code >= 0xd800 && code <= 0xdfff) return match;
    return String.fromCodePoint(code);
  });
}

function stripIgnorable(value: string): string {
  let stripped = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20) continue;
    if (code >= 0x2000 && code <= 0x200f) continue;
    if (IGNORED_CODE_POINTS.has(code)) continue;
    stripped += character;
  }
  return stripped;
}

function isSafeUrl(raw: string): boolean {
  const value = stripIgnorable(decodeEntities(raw));
  if (value.length === 0) return true;
  const colon = value.indexOf(':');
  if (colon === -1) return true;
  for (const delimiter of ['/', '?', '#']) {
    const at = value.indexOf(delimiter);
    if (at !== -1 && at < colon) return true;
  }
  return SAFE_SCHEMES.has(value.slice(0, colon).toLowerCase());
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const LAYOUT_DATA_ATTR = new Set(['data-table-scroll', 'data-code-block', 'data-code-language']);

const TASK_DATA_ATTR = new Map([
  ['data-type', { tag: 'ul', values: new Set(['taskList']) }],
  ['data-checked', { tag: 'li', values: new Set(['true', 'false']) }],
]);

function attributeAllowed(tag: string, key: string, value: string): boolean {
  if (key === 'id') return HEADING_TAGS.has(tag);
  if (LAYOUT_DATA_ATTR.has(key)) return tag === 'div' || tag === 'span';
  const task = TASK_DATA_ATTR.get(key);
  if (task !== undefined) return tag === task.tag && task.values.has(value);
  return ALLOWED_ATTR.has(key);
}

function keptAttributes(
  tag: string,
  present: readonly (readonly [string, string])[],
): Map<string, string> {
  const keep = new Map<string, string>();
  for (const [name, value] of present) {
    const key = name.toLowerCase();
    if (keep.has(key)) continue;
    if (!attributeAllowed(tag, key, value)) continue;
    if (URL_ATTR.has(key) && !isSafeUrl(value)) continue;
    keep.set(key, value);
  }
  return keep;
}

function externalLinkTarget(keep: ReadonlyMap<string, string>): boolean {
  const href = stripIgnorable(decodeEntities(keep.get('href') ?? ''));
  return href.length > 0 && ABSOLUTE_URL.test(href);
}

interface AttributeTarget {
  setAttribute(name: string, value: string): unknown;
  removeAttribute(name: string): unknown;
}

function applyTagRules(
  tag: string,
  keep: ReadonlyMap<string, string>,
  element: AttributeTarget,
): void {
  if (tag === 'img') {
    for (const [key, value] of IMAGE_DEFAULTS) element.setAttribute(key, value);
    return;
  }
  if (tag !== 'a') return;
  element.removeAttribute('target');
  element.removeAttribute('rel');
  if (!externalLinkTarget(keep)) return;
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', 'noopener noreferrer');
}

let rewriter: HTMLRewriter | null = null;

function bunSanitizer(): HTMLRewriter {
  rewriter ??= new HTMLRewriter()
    .on('*', {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (DROP_WITH_CONTENT.has(tag)) {
          element.remove();
          return;
        }
        if (!ALLOWED_TAGS.has(tag)) {
          element.removeAndKeepContent();
          return;
        }
        const present: [string, string][] = [];
        for (const attribute of element.attributes) present.push(attribute);
        for (const [name] of present) element.removeAttribute(name);

        const keep = keptAttributes(tag, present);
        for (const [key, value] of keep) element.setAttribute(key, value);
        applyTagRules(tag, keep, element);
      },
    })
    .onDocument({
      comments(comment) {
        comment.remove();
      },
    });
  return rewriter;
}

interface Markup {
  readonly nodes: ChildNode[];
  html(): string;
}

function markupHolder(html: string): Markup {
  if (typeof globalThis.document !== 'undefined') {
    const template = globalThis.document.createElement('template');
    template.innerHTML = html;
    return {
      nodes: Array.from(template.content.childNodes),
      html: () => template.innerHTML,
    };
  }
  const body = parseHTML(`<!doctype html><html><body>${html}</body></html>`).document
    .body as unknown as Element;
  return {
    nodes: Array.from(body.childNodes) as ChildNode[],
    html: () => body.innerHTML,
  };
}

const COMMENT_NODE = 8;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function asElement(node: ChildNode): Element | null {
  return node.nodeType === ELEMENT_NODE ? (node as unknown as Element) : null;
}

function cleanDomNode(node: ChildNode): void {
  if (node.nodeType === COMMENT_NODE) {
    node.remove();
    return;
  }
  const element = asElement(node);
  if (element === null) return;

  const tag = element.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) {
    element.remove();
    return;
  }

  const children = Array.from(element.childNodes);
  if (ALLOWED_TAGS.has(tag)) {
    const present = Array.from(element.attributes).map((attribute): [string, string] => [
      attribute.name,
      attribute.value,
    ]);
    for (const [name] of present) element.removeAttribute(name);

    const keep = keptAttributes(tag, present);
    for (const [key, value] of keep) element.setAttribute(key, value);
    applyTagRules(tag, keep, element);
  } else {
    element.replaceWith(...children);
  }

  for (const child of children) cleanDomNode(child);
}

function sanitizeInDom(html: string): string {
  const holder = markupHolder(html);
  for (const node of holder.nodes) cleanDomNode(node);
  return holder.html();
}

export function sanitizeHtml(html: string): string {
  if (html.length === 0) return '';
  if (typeof HTMLRewriter === 'undefined') return sanitizeInDom(html);
  return bunSanitizer().transform(html);
}

const VOID_TEXT_TAGS = new Set(['br', 'hr', 'img', 'input']);

function collectDomText(nodes: readonly ChildNode[], parts: string[]): void {
  for (const child of nodes) {
    if (child.nodeType === TEXT_NODE) {
      parts.push(child.textContent ?? '');
      continue;
    }
    const element = asElement(child);
    if (element === null) continue;
    if (VOID_TEXT_TAGS.has(element.tagName.toLowerCase())) parts.push(' ');
    collectDomText(Array.from(element.childNodes), parts);
  }
}

function textInDom(html: string): string {
  const parts: string[] = [];
  collectDomText(markupHolder(html).nodes, parts);
  return parts.join('');
}

export function htmlToText(html: string): string {
  if (html.length === 0) return '';
  if (typeof HTMLRewriter === 'undefined') return textInDom(html);
  const parts: string[] = [];
  new HTMLRewriter()
    .on('*', {
      element(element) {
        if (VOID_TEXT_TAGS.has(element.tagName.toLowerCase())) parts.push(' ');
      },
    })
    .onDocument({
      text(chunk) {
        parts.push(chunk.text);
      },
      comments(comment) {
        comment.remove();
      },
    })
    .transform(html);
  return parts.join('');
}
