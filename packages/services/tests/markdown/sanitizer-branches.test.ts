import { afterAll, describe, expect, it } from 'bun:test';
import { renderMarkdown, renderPlainText } from '../../src/markdown/index.ts';
import {
  canonicalHtml,
  DANGEROUS,
  restoreRewriter,
  rewriterAvailable,
  withoutRewriter,
  XSS_VECTORS,
  type XssVector,
} from './sanitizer-vectors.ts';

afterAll(restoreRewriter);

const AGREEING = XSS_VECTORS.filter((vector) => vector.parserDiverges !== true);

function assertSafe(html: string, vector: XssVector): void {
  expect(html).not.toMatch(DANGEROUS);
  for (const fragment of vector.absent ?? []) expect(html).not.toContain(fragment);
  for (const fragment of vector.present ?? []) expect(html).toContain(fragment);
}

describe('the rewriter branch bun runs under', () => {
  it('is the branch this process takes by default', () => {
    expect(rewriterAvailable()).toBe(true);
  });

  for (const vector of XSS_VECTORS) {
    it(`neutralises ${vector.name}`, () => {
      assertSafe(renderMarkdown(vector.source), vector);
    });
  }
});

describe('the linkedom branch node ships to production', () => {
  it('is the branch taken once HTMLRewriter is gone, and the global is put back after', () => {
    withoutRewriter(() => {
      expect(typeof HTMLRewriter).toBe('undefined');
    });
    expect(typeof HTMLRewriter).toBe('function');
  });

  for (const vector of XSS_VECTORS) {
    it(`neutralises ${vector.name}`, () => {
      assertSafe(
        withoutRewriter(() => renderMarkdown(vector.source)),
        vector,
      );
    });
  }
});

describe('the two sanitizer branches do not drift apart', () => {
  for (const vector of AGREEING) {
    it(`renders ${vector.name} the same on node and on bun`, () => {
      const viaRewriter = renderMarkdown(vector.source);
      const viaDom = withoutRewriter(() => renderMarkdown(vector.source));
      expect(canonicalHtml(viaDom)).toBe(canonicalHtml(viaRewriter));
    });

    it(`flattens ${vector.name} to the same text on node and on bun`, () => {
      const viaRewriter = renderPlainText(vector.source);
      const viaDom = withoutRewriter(() => renderPlainText(vector.source));
      expect(viaDom).toBe(viaRewriter);
    });
  }

  it('keeps every vector that survives canonicalisation in the drift check', () => {
    expect(AGREEING.length).toBeGreaterThan(40);
    expect(XSS_VECTORS.length - AGREEING.length).toBe(2);
  });
});

describe('canonicalHtml only reorders attributes', () => {
  it('sorts attributes so a benign parser ordering difference is not a failure', () => {
    expect(canonicalHtml('<a href="/x" target="_blank" rel="noopener">y</a>')).toBe(
      canonicalHtml('<a rel="noopener" target="_blank" href="/x">y</a>'),
    );
  });

  it('still separates two tags that kept different attributes', () => {
    expect(canonicalHtml('<img src="x" onerror="y">')).not.toBe(canonicalHtml('<img src="x">'));
  });

  it('still separates two documents whose elements differ', () => {
    expect(canonicalHtml('<p>a</p>')).not.toBe(canonicalHtml('<p>a</p><iframe></iframe>'));
  });
});
