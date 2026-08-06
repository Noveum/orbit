import { describe, expect, it } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { render, screen } from '@testing-library/react';
import { DocBody } from '../../../src/features/docs/doc-body.tsx';

const SOURCE = ['```ts', 'const total = 1;', '```'].join('\n');

function renderBody(markdown: string) {
  render(<DocBody html={renderMarkdownWithHeadingIds(markdown)} />);
  return screen.getByTestId('doc-body');
}

describe('code colours on the read path', () => {
  it('emits highlight tokens a reader can see and styles them in the same class', () => {
    const body = renderBody(SOURCE);

    expect(body.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(body.querySelector('.hljs-number')?.textContent).toBe('1');
    expect(body.className).toContain('[&_.hljs-keyword]:text-accent');
    expect(body.className).toContain('[&_.hljs-number]:text-warning');
  });

  it('keeps the code readable as text so copy and search still work', () => {
    expect(renderBody(SOURCE).querySelector('pre')?.textContent?.trim()).toBe('const total = 1;');
  });
});
