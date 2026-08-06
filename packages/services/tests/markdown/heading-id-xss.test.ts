import { describe, expect, it } from 'bun:test';
import { parseHTML } from 'linkedom';
import { renderMarkdownWithHeadingIds } from '../../src/markdown/index.ts';

function rendered(source: string): string {
  return renderMarkdownWithHeadingIds(source);
}

function elementsIn(html: string): string[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return Array.from(document.body.querySelectorAll('*')).map((node) => node.tagName.toLowerCase());
}

function eventHandlersIn(html: string): string[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const found: string[] = [];
  for (const node of Array.from(document.body.querySelectorAll('*'))) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) found.push(attribute.name);
    }
  }
  return found;
}

describe('renderMarkdownWithHeadingIds', () => {
  it('still gives every heading an anchor id', () => {
    const html = rendered('# Release notes\n\n## Breaking changes\n');
    expect(html).toContain('id="release-notes"');
    expect(html).toContain('id="breaking-changes"');
  });

  it('keeps ids unique when two headings share a title', () => {
    const html = rendered('# Notes\n\n# Notes\n');
    expect(html).toContain('id="notes"');
    expect(html).toContain('id="notes-1"');
  });

  it('does not let an attribute value containing a bracket smuggle an element out', () => {
    const html = rendered('<h1 title="a><img src=x onerror=alert(1)>">Release notes</h1>');
    expect(elementsIn(html)).toEqual(['h1']);
    expect(eventHandlersIn(html)).toEqual([]);
  });

  it('closes the entity encoded form of the same break out', () => {
    for (const bracket of ['&gt;', '&#62;', '&#x3e;']) {
      const html = rendered(`<h2 title="a${bracket}<img src=x onerror=alert(1)>">Plan</h2>`);
      expect(elementsIn(html)).toEqual(['h2']);
      expect(eventHandlersIn(html)).toEqual([]);
    }
  });

  it('holds for the other attributes the sanitizer keeps', () => {
    for (const attribute of ['class', 'alt', 'width', 'start', 'rel']) {
      const html = rendered(`<h3 ${attribute}="a><img src=x onerror=alert(1)>">Q3</h3>`);
      expect(elementsIn(html)).toEqual(['h3']);
      expect(eventHandlersIn(html)).toEqual([]);
    }
  });

  it('refuses an id the author wrote onto a non heading element', () => {
    const html = rendered('<p id="body">Text</p>');
    expect(html).not.toContain('id="body"');
  });

  it('replaces an id the author put on a heading rather than keeping both', () => {
    const html = rendered('<h1 id="attacker">Release notes</h1>');
    expect(html).toContain('id="release-notes"');
    expect(html).not.toContain('id="attacker"');
  });

  it('leaves ordinary markdown alone', () => {
    const html = rendered('# Title\n\nSome **bold** text and a [link](https://example.com).\n');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
  });
});
