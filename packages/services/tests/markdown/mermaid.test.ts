import { describe, expect, it } from 'bun:test';
import { renderMarkdown, renderPlainText } from '../../src/markdown/index.ts';

const DIAGRAM = ['```mermaid', 'graph TD', '  A[Start] --> B{Ship?}', '```'].join('\n');

describe('mermaid fences', () => {
  it('marks the block so the reader can draw it and keeps the source readable', () => {
    const html = renderMarkdown(DIAGRAM);

    expect(html).toContain('<div data-mermaid');
    expect(html).toContain('<code class="language-mermaid">');
    expect(html).toContain('graph TD');
    expect(html).not.toContain('data-code-block');
    expect(html).not.toContain('hljs');
  });

  it('survives sanitising, because the marker is what the client looks for', () => {
    expect(renderMarkdown(DIAGRAM)).toContain('data-mermaid');
  });

  it('escapes the diagram source instead of trusting it as markup', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  A["<img src=x onerror=alert(1)>"]\n```');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('accepts the language however the fence spelled it', () => {
    expect(renderMarkdown('```Mermaid\ngraph TD\n```')).toContain('data-mermaid');
    expect(renderMarkdown('```mermaid render\ngraph TD\n```')).toContain('data-mermaid');
  });

  it('leaves every other language on the highlighted path', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');

    expect(html).toContain('data-code-block');
    expect(html).not.toContain('data-mermaid');
  });

  it('reads back as its own source in plain text, so search and summaries stay honest', () => {
    expect(renderPlainText(DIAGRAM)).toContain('graph TD');
  });
});
