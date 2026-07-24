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

function keptAttributes(present: readonly (readonly [string, string])[]): Map<string, string> {
  const keep = new Map<string, string>();
  for (const [name, value] of present) {
    const key = name.toLowerCase();
    if (keep.has(key)) continue;
    if (!ALLOWED_ATTR.has(key)) continue;
    if (URL_ATTR.has(key) && !isSafeUrl(value)) continue;
    keep.set(key, value);
  }
  return keep;
}

function externalLinkTarget(keep: ReadonlyMap<string, string>): boolean {
  const href = stripIgnorable(decodeEntities(keep.get('href') ?? ''));
  return href.length > 0 && ABSOLUTE_URL.test(href);
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

        const keep = keptAttributes(present);
        for (const [key, value] of keep) element.setAttribute(key, value);

        if (tag !== 'a') return;
        element.removeAttribute('target');
        element.removeAttribute('rel');
        if (!externalLinkTarget(keep)) return;
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      },
    })
    .onDocument({
      comments(comment) {
        comment.remove();
      },
    });
  return rewriter;
}

function cleanDomNode(node: ChildNode): void {
  if (node instanceof Comment) {
    node.remove();
    return;
  }
  if (!(node instanceof Element)) return;

  const tag = node.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) {
    node.remove();
    return;
  }

  const children = Array.from(node.childNodes);
  if (ALLOWED_TAGS.has(tag)) {
    const present = Array.from(node.attributes).map((attribute): [string, string] => [
      attribute.name,
      attribute.value,
    ]);
    for (const [name] of present) node.removeAttribute(name);

    const keep = keptAttributes(present);
    for (const [key, value] of keep) node.setAttribute(key, value);

    if (tag === 'a' && externalLinkTarget(keep)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  } else {
    node.replaceWith(...children);
  }

  for (const child of children) cleanDomNode(child);
}

function sanitizeInDom(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of Array.from(template.content.childNodes)) cleanDomNode(node);
  return template.innerHTML;
}

export function sanitizeHtml(html: string): string {
  if (html.length === 0) return '';
  if (typeof HTMLRewriter === 'undefined') return sanitizeInDom(html);
  return bunSanitizer().transform(html);
}

const VOID_TEXT_TAGS = new Set(['br', 'hr', 'img', 'input']);

function collectDomText(node: Node, parts: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child instanceof Text) {
      parts.push(child.data);
      continue;
    }
    if (!(child instanceof Element)) continue;
    if (VOID_TEXT_TAGS.has(child.tagName.toLowerCase())) parts.push(' ');
    collectDomText(child, parts);
  }
}

function textInDom(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const parts: string[] = [];
  collectDomText(template.content, parts);
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
