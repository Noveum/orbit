import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import {
  type DocHeading,
  EMPTY_OUTLINE,
  extractHeadings,
  outlineFor,
} from '../src/features/docs/outline.ts';

const HEADINGS = 241;
const KEYSTROKES = 30;
const WARMUPS = 3;

function fixture(tail: string): string {
  const lines: string[] = ['# Engineering handbook', ''];
  for (let section = 1; section <= HEADINGS - 1; section += 1) {
    lines.push(
      `## Section ${section}`,
      '',
      `Body paragraph ${section} explaining what the section covers and why it exists.`,
      '',
      `![figure ${section}](https://cdn.example.com/figure-${section}.png)`,
      '',
    );
  }
  lines.push(tail);
  return lines.join('\n');
}

function build(source: string): readonly DocHeading[] {
  return extractHeadings(renderMarkdownWithHeadingIds(source));
}

function typedDocuments(): string[] {
  const documents: string[] = [];
  let typed = '';
  for (let stroke = 0; stroke < KEYSTROKES; stroke += 1) {
    typed += 'a';
    documents.push(fixture(typed));
  }
  return documents;
}

function typeBody(documents: readonly string[], memoised: boolean): number {
  const typed = documents.slice(1);
  let memo = outlineFor(EMPTY_OUTLINE, documents[0] ?? '', build);
  const started = performance.now();
  for (const source of typed) {
    memo = memoised
      ? outlineFor(memo, source, build)
      : { signature: null, headings: build(source) };
  }
  return (performance.now() - started) / typed.length;
}

function main(): void {
  const opened = fixture('tail');
  const headings = build(opened);
  if (headings.length !== HEADINGS) {
    throw new Error(`Expected ${HEADINGS} headings, the renderer found ${headings.length}`);
  }

  const documents = typedDocuments();
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    typeBody(documents, true);
    typeBody(documents, false);
  }

  const rebuilt = typeBody(documents, false);
  const memoised = typeBody(documents, true);

  console.info(`document: ${opened.length} bytes, ${headings.length} headings`);
  console.info(`outline per keystroke, rebuilt every time: ${rebuilt.toFixed(2)}ms`);
  console.info(
    `outline per keystroke, memoised on the heading signature: ${memoised.toFixed(2)}ms`,
  );
}

main();
