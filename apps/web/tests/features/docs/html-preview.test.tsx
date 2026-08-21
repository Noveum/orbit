import { describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@/test/render.tsx';
import { HtmlPreview } from '../../../src/features/docs/html-preview.tsx';
import { HTML_ARTIFACT_CSP, HTML_IFRAME_SANDBOX } from '../../../src/lib/docs/html-artifact.ts';

describe('an html page preview', () => {
  it('runs the page in a sandbox without same-origin access', () => {
    render(<HtmlPreview title="Sync health" html="<p>ok</p>" />);
    const frame = screen.getByTestId('html-preview');
    expect(frame.getAttribute('sandbox')).toBe(HTML_IFRAME_SANDBOX);
    expect(frame.getAttribute('sandbox') ?? '').not.toContain('allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toBe('<p>ok</p>');
    cleanup();
  });

  it('isolates a published page with a sandbox csp', () => {
    expect(HTML_ARTIFACT_CSP.startsWith('sandbox ')).toBe(true);
    expect(HTML_ARTIFACT_CSP).not.toContain('allow-same-origin');
  });
});
