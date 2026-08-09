import { describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import htmlToPdfmake from 'html-to-pdfmake';

const DOCUMENT = [
  '# Voice / Audio Eval',
  '',
  'A paragraph with **bold**, _italic_ and `inline code`, plus a [link](https://orbit.test).',
  '',
  '## Results',
  '',
  '| Tier | Model | Cost |',
  '|---|---|---|',
  '| Standard | `gemini-2.5-flash` | ~$2,174 |',
  '',
  '- [ ] an open task',
  '- [x] a finished task',
  '',
  '> a quoted line',
  '',
  '```ts',
  'const delta = 1;',
  '```',
].join('\n');

function flatten(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, into);
    return into;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) flatten(value, into);
    return into;
  }
  if (typeof node === 'string') into.push(node);
  return into;
}

describe('markdown all the way to a pdfmake document', () => {
  const definition = htmlToPdfmake(renderMarkdown(DOCUMENT), { window });
  const text = flatten(definition).join(' ');

  it('keeps the words as text rather than turning them into a picture', () => {
    expect(text).toContain('Voice / Audio Eval');
    expect(text).toContain('A paragraph with');
    expect(text).toContain('gemini-2.5-flash');
  });

  it('carries a table through as a table, not a flattened line', () => {
    const asJson = JSON.stringify(definition);
    expect(asJson).toContain('"table"');
    expect(text).toContain('Standard');
  });

  it('keeps both task list items', () => {
    expect(text).toContain('an open task');
    expect(text).toContain('a finished task');
  });

  it('keeps a fenced code block, still syntax highlighted, and a quote', () => {
    const compact = text.replace(/\s+/g, ' ');
    expect(compact).toContain('const');
    expect(compact).toContain('delta =');
    expect(compact).toContain('hljs-keyword');
    expect(text).toContain('a quoted line');
  });

  it('keeps a link and its destination', () => {
    expect(JSON.stringify(definition)).toContain('https://orbit.test');
  });

  it('builds a large document in reasonable time', () => {
    const long = `${DOCUMENT}\n\n${'Body copy that repeats. '.repeat(4000)}`;
    expect(long.length).toBeGreaterThan(90_000);
    const started = performance.now();
    const built = htmlToPdfmake(renderMarkdown(long), { window });
    const elapsed = performance.now() - started;
    expect(built).toBeTruthy();
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);
});
