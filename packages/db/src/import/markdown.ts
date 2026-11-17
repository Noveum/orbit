import { parseHTML } from 'linkedom';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function escapedText(text: string): string {
  return text
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/([*`[\]_~#()+|=-])/g, '\\$1');
}

function destination(value: string): string {
  return value
    .replace(/[<>"\s]/g, (character) => encodeURIComponent(character))
    .replace(/\\/g, '\\\\')
    .replace(/[()]/g, '\\$&')
    .replace(/&/g, '&amp;');
}

function backtickRun(text: string, minimum: number): string {
  let length = minimum;
  for (const run of text.match(/`+/g) ?? []) length = Math.max(length, run.length + 1);
  return '`'.repeat(length);
}

function inlineCode(text: string): string {
  const value = text.replace(/[\r\n]/g, ' ');
  const fence = backtickRun(value, 1);
  const padding =
    value.startsWith('`') ||
    value.endsWith('`') ||
    (value.startsWith(' ') && value.endsWith(' ') && value.trim().length > 0)
      ? ' '
      : '';
  return fence + padding + value + padding + fence;
}

function markedText(text: string, marker: string): string {
  const value = text.trim();
  if (value.length === 0) return text;
  const leading = text.slice(0, text.indexOf(value));
  const trailing = text.slice(text.indexOf(value) + value.length);
  return leading + marker + value + marker + trailing;
}

function childrenMarkdown(parent: Node & ParentNode): string {
  let markdown = '';
  for (const child of Array.from(parent.childNodes)) {
    const next = nodeMarkdown(child);
    if (next.startsWith('\n')) markdown = markdown.trimEnd() + next;
    else if (!(next.trim().length === 0 && markdown.endsWith('\n'))) markdown += next;
  }
  return markdown;
}

function contentMarkdown(element: Element, tag: string): string {
  const content = childrenMarkdown(element);
  switch (tag) {
    case 'a': {
      const href = element.getAttribute('href') ?? '';
      const label = content.trim();
      return label.length === 0 ? escapedText(href) : `[${label}](${destination(href)})`;
    }
    case 'strong':
    case 'b':
      return markedText(content, '**');
    case 'em':
    case 'i':
      return markedText(content, '_');
    case 'li':
      return `- ${content.trim().replace(/\n/g, '\n  ')}\n`;
    case 'ul':
    case 'ol':
      return `\n${content.trim()}\n`;
    case 'blockquote':
      return `\n\n${content
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`;
    case 'p':
    case 'div':
    case 'tr': {
      const body = content.trim();
      return body.length === 0 ? '' : `\n\n${body}\n\n`;
    }
    default:
      return /^h[1-6]$/.test(tag) ? `\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n` : content;
  }
}

function nodeMarkdown(node: ChildNode): string {
  if (node.nodeType === TEXT_NODE)
    return escapedText(node.textContent ?? '').replace(/[:.@]/g, (character) => `\\${character}`);
  if (node.nodeType !== ELEMENT_NODE) return '';
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'head':
    case 'script':
    case 'style':
      return '';
    case 'pre': {
      const text = element.textContent ?? '';
      const fence = backtickRun(text, 3);
      return `\n\n${fence}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    }
    case 'code':
      return inlineCode(element.textContent ?? '');
    case 'br':
      return '  \n';
    case 'img': {
      const alt = escapedText(element.getAttribute('alt') ?? '');
      return `![${alt}](${destination(element.getAttribute('src') ?? '')})`;
    }
    default:
      return contentMarkdown(element, tag);
  }
}

export function htmlToMarkdown(html: string | null | undefined): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  const { document } = parseHTML(html);
  return childrenMarkdown(document.querySelector('body') ?? document).trim();
}
