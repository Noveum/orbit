import { afterAll, describe, expect, it } from 'bun:test';
import { parseHTML } from 'linkedom';
import { renderMarkdown, renderMarkdownWithHeadingIds } from '../../src/markdown/index.ts';

const globals = globalThis as { HTMLRewriter?: unknown };
const bunRewriter = globals.HTMLRewriter;

function withoutRewriter<T>(run: () => T): T {
  globals.HTMLRewriter = undefined;
  try {
    return run();
  } finally {
    globals.HTMLRewriter = bunRewriter;
  }
}

function withRewriter<T>(run: () => T): T {
  return run();
}

afterAll(() => {
  globals.HTMLRewriter = bunRewriter;
});

interface ImageAttributes {
  readonly src: string | null;
  readonly loading: string | null;
  readonly decoding: string | null;
}

function bodyOf(html: string) {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body;
}

function imagesIn(html: string): ImageAttributes[] {
  return Array.from(bodyOf(html).querySelectorAll('img')).map((node) => ({
    src: node.getAttribute('src'),
    loading: node.getAttribute('loading'),
    decoding: node.getAttribute('decoding'),
  }));
}

function elementsIn(html: string): string[] {
  return Array.from(bodyOf(html).querySelectorAll('*')).map((node) => node.tagName.toLowerCase());
}

function eventHandlersIn(html: string): string[] {
  const found: string[] = [];
  for (const node of Array.from(bodyOf(html).querySelectorAll('*'))) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) found.push(attribute.name);
    }
  }
  return found;
}

const sanitizers = [
  { name: 'the rewriter sanitizer', run: withRewriter },
  { name: 'the dom sanitizer', run: withoutRewriter },
] as const;

const renderers = [
  { name: 'renderMarkdown', render: renderMarkdown },
  { name: 'renderMarkdownWithHeadingIds', render: renderMarkdownWithHeadingIds },
] as const;

const BREAK_OUT = '<img src="https://x.dev/a.png" alt="a><img src=y onerror=alert(1)>">';

for (const sanitizer of sanitizers) {
  for (const renderer of renderers) {
    describe(`${renderer.name} through ${sanitizer.name}`, () => {
      it('defers every image it renders', () => {
        const html = sanitizer.run(() =>
          renderer.render('![a](https://x.dev/a.png)\n\n![b](https://x.dev/b.png)'),
        );

        expect(imagesIn(html)).toEqual([
          { src: 'https://x.dev/a.png', loading: 'lazy', decoding: 'async' },
          { src: 'https://x.dev/b.png', loading: 'lazy', decoding: 'async' },
        ]);
      });

      it('defers an image the author wrote as raw html', () => {
        const html = sanitizer.run(() => renderer.render('<img src="https://x.dev/a.png">'));

        expect(imagesIn(html)).toEqual([
          { src: 'https://x.dev/a.png', loading: 'lazy', decoding: 'async' },
        ]);
      });

      it('overrides an eager loading the author asked for', () => {
        const html = sanitizer.run(() =>
          renderer.render('<img src="https://x.dev/a.png" loading="eager" decoding="sync">'),
        );

        expect(imagesIn(html)).toEqual([
          { src: 'https://x.dev/a.png', loading: 'lazy', decoding: 'async' },
        ]);
      });

      it('does not let an image attribute containing a bracket smuggle an element out', () => {
        const html = sanitizer.run(() => renderer.render(BREAK_OUT));

        expect(elementsIn(html)).toEqual(['img']);
        expect(eventHandlersIn(html)).toEqual([]);
        expect(imagesIn(html)).toEqual([
          { src: 'https://x.dev/a.png', loading: 'lazy', decoding: 'async' },
        ]);
      });

      it('closes the entity encoded form of the same break out', () => {
        for (const bracket of ['&gt;', '&#62;', '&#x3e;']) {
          const html = sanitizer.run(() =>
            renderer.render(
              `<img src="https://x.dev/a.png" alt="a${bracket}<img src=y onerror=alert(1)>">`,
            ),
          );

          expect(elementsIn(html)).toEqual(['img']);
          expect(eventHandlersIn(html)).toEqual([]);
        }
      });

      it('leaves an image alone when the markdown around it changes', () => {
        const html = sanitizer.run(() =>
          renderer.render('# Title\n\ntext\n\n![a](https://x.dev/a.png)\n'),
        );

        expect(imagesIn(html)).toEqual([
          { src: 'https://x.dev/a.png', loading: 'lazy', decoding: 'async' },
        ]);
      });
    });
  }
}
