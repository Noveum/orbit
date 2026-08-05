import { afterEach, describe, expect, it } from 'bun:test';
import { toEditorHtml } from '../../../../src/features/docs/editor/extensions.ts';

const realDocument = globalThis.document;

function withoutDom(run: () => void): void {
  Reflect.deleteProperty(globalThis, 'document');
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, 'document', {
      value: realDocument,
      configurable: true,
      writable: true,
    });
  }
}

afterEach(() => {
  if (globalThis.document === undefined) {
    Object.defineProperty(globalThis, 'document', {
      value: realDocument,
      configurable: true,
      writable: true,
    });
  }
});

describe('preparing html for the editor where there is no DOM', () => {
  it('hands the html back untouched instead of throwing on the server', () => {
    withoutDom(() => {
      expect(toEditorHtml('<h1>Runbook</h1><p>Body.</p>')).toBe('<h1>Runbook</h1><p>Body.</p>');
    });
  });

  it('still enriches the html in the browser, where the editor actually uses it', () => {
    const enriched = toEditorHtml('<ul><li><input type="checkbox"> Ship it</li></ul>');
    expect(enriched.length).toBeGreaterThan(0);
    expect(enriched).toContain('Ship it');
  });
});
