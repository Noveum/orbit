import { afterEach, describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocBody, docProseClassName } from '@/features/docs/doc-body.tsx';
import {
  DIAGRAM_FAILED,
  DIAGRAM_LABEL,
  DIAGRAM_OPEN_EVENT,
  DIAGRAM_UNAVAILABLE,
  type DiagramOpenDetail,
  drawDiagrams,
  fitsTheColumn,
  LEGIBLE_SCALE,
  type MermaidRenderer,
  mermaidConfig,
  naturalWidth,
  SHOW_DIAGRAM_LABEL,
  SHOW_SOURCE_LABEL,
  safeSvg,
} from '@/features/docs/mermaid.ts';

afterEach(cleanup);

const DIAGRAM = ['```mermaid', 'graph TD', '  A[Start] --> B[Ship]', '```'].join('\n');

function blockFrom(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderMarkdown(markdown);
  document.body.append(host);
  return host;
}

function fakeMermaid(svg: string): { renderer: MermaidRenderer; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    renderer: {
      initialize: () => undefined,
      render: (_id: string, source: string) => {
        calls.push(source);
        if (source.includes('boom')) return Promise.reject(new Error('bad syntax'));
        return Promise.resolve({ svg });
      },
    },
  };
}

const SVG = '<svg role="graphics-document"><g data-testid="graphics-hint"></g></svg>';

describe('a mermaid diagram in a doc', () => {
  it('draws the fence into the block and keeps the source for the fallback', async () => {
    const host = blockFrom(DIAGRAM);
    const { renderer, calls } = fakeMermaid(SVG);

    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));

    expect(calls[0]).toContain('graph TD');
    const block = host.querySelector('[data-mermaid]');
    expect(block?.getAttribute('data-mermaid-view')).toBe('diagram');
    expect(block?.querySelector('[data-mermaid-canvas]')?.innerHTML).toContain('graphics-hint');
    expect(block?.querySelector('code')?.textContent).toContain('graph TD');
  });

  it('falls back to the source with a note when the diagram will not parse', async () => {
    const host = blockFrom('```mermaid\nboom boom\n```');
    const { renderer } = fakeMermaid(SVG);

    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));

    const block = host.querySelector('[data-mermaid]');
    expect(block?.getAttribute('data-mermaid-view')).toBe('source');
    expect(block?.querySelector('[data-mermaid-canvas]')).toBeNull();
    expect(block?.textContent).toContain(DIAGRAM_FAILED);
    expect(block?.textContent).toContain('boom boom');
  });

  it('draws each block once, however often the reader re renders', async () => {
    const host = blockFrom(DIAGRAM);
    const { renderer, calls } = fakeMermaid(SVG);

    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));
    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));

    expect(calls).toHaveLength(1);
  });

  it('draws again when the theme flips, because the colours are baked into the svg', async () => {
    const host = blockFrom(DIAGRAM);
    const { renderer, calls } = fakeMermaid(SVG);

    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));
    await drawDiagrams(host, 'dark', () => Promise.resolve(renderer));

    expect(calls).toHaveLength(2);
  });

  it('offers a toggle between the diagram and the source it came from', async () => {
    const user = userEvent.setup();
    const host = blockFrom(DIAGRAM);
    const { renderer } = fakeMermaid(SVG);

    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));

    const toggle = host.querySelector<HTMLButtonElement>('[data-mermaid-view-toggle]');
    expect(toggle?.getAttribute('aria-label')).toBe(SHOW_SOURCE_LABEL);
    if (toggle === null) throw new Error('no toggle');

    await user.click(toggle);
    expect(host.querySelector('[data-mermaid]')?.getAttribute('data-mermaid-view')).toBe('source');
    expect(toggle.getAttribute('aria-label')).toBe(SHOW_DIAGRAM_LABEL);

    await user.click(toggle);
    expect(host.querySelector('[data-mermaid]')?.getAttribute('data-mermaid-view')).toBe('diagram');
  });

  it('says so when the renderer itself never loads, rather than going quiet', async () => {
    const host = blockFrom(DIAGRAM);

    await drawDiagrams(host, 'light', () => Promise.reject(new Error('chunk gone')));

    const block = host.querySelector('[data-mermaid]');
    expect(block?.textContent).toContain(DIAGRAM_UNAVAILABLE);
    expect(block?.getAttribute('data-mermaid-view')).toBe('source');
  });

  it('lets the newer pass win when a theme flips mid draw', async () => {
    const host = blockFrom(DIAGRAM);
    const light = fakeMermaid('<svg><g data-testid="light-hint"></g></svg>');
    const dark = fakeMermaid('<svg><g data-testid="dark-hint"></g></svg>');

    const slow = drawDiagrams(host, 'light', () => Promise.resolve(light.renderer));
    await drawDiagrams(host, 'dark', () => Promise.resolve(dark.renderer));
    await slow;

    expect(host.querySelector('[data-mermaid-canvas]')?.innerHTML).toContain('dark-hint');
  });

  it('leaves a document without a diagram alone', async () => {
    const host = blockFrom('```ts\nconst a = 1;\n```');
    const { renderer, calls } = fakeMermaid(SVG);

    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));

    expect(calls).toHaveLength(0);
  });
});

describe('the reader', () => {
  it('renders a mermaid fence as its own block rather than a highlighted code block', async () => {
    render(<DocBody html={renderMarkdown(DIAGRAM)} />);

    await waitFor(() => {
      expect(screen.getByTestId('doc-body').querySelector('[data-mermaid]')).not.toBeNull();
    });
    expect(screen.getByTestId('doc-body').querySelector('[data-code-block]')).toBeNull();
  });

  it('hides the source once a diagram is drawn', () => {
    expect(docProseClassName).toContain('[&_[data-mermaid][data-mermaid-view=diagram]_pre]:hidden');
  });
});

describe('the drawn markup', () => {
  it('goes through the sanitiser on its way to the page', () => {
    expect(safeSvg('<g><text>hi</text></g>')).toContain('hi');
  });

  it('asks mermaid for plain svg labels, because the sanitiser drops foreign objects', () => {
    const styles = { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;

    expect(mermaidConfig(styles, false).htmlLabels).toBe(false);
    expect(mermaidConfig(styles, false).flowchart?.htmlLabels).toBe(false);
  });
});

describe('a diagram wider than the column', () => {
  it('is scaled down only while it stays legible, and otherwise keeps its own size', () => {
    expect(fitsTheColumn(600, 700)).toBe(true);
    expect(fitsTheColumn(800, 700)).toBe(true);
    expect(fitsTheColumn(3000, 700)).toBe(false);
    expect(fitsTheColumn(700 / LEGIBLE_SCALE, 700)).toBe(true);
    expect(fitsTheColumn(700 / LEGIBLE_SCALE + 1, 700)).toBe(false);
  });

  it('decides nothing before the page has laid the block out', () => {
    expect(fitsTheColumn(0, 700)).toBe(false);
    expect(fitsTheColumn(600, 0)).toBe(false);
  });

  it('asks mermaid for the diagram at its own size, never squeezed into the column', () => {
    const styles = { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
    const config = mermaidConfig(styles, false);

    expect(config.flowchart?.useMaxWidth).toBe(false);
    expect(config.sequence?.useMaxWidth).toBe(false);
    expect(config.gantt?.useMaxWidth).toBe(false);
  });
});

describe('the width a diagram is measured at', () => {
  function svgWith(attributes: Record<string, string>): SVGSVGElement {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element as unknown as SVGSVGElement;
  }

  it('reads the size the diagram was drawn at, not the size css left it', () => {
    expect(naturalWidth(svgWith({ width: '1600', viewBox: '0 0 1600 400' }))).toBe(1600);
  });

  it('falls back to the declared width when the view box is out of reach', () => {
    expect(naturalWidth(svgWith({ width: '820' }))).toBe(820);
  });

  it('answers 0 when a diagram declares nothing, so no decision is taken on it', () => {
    expect(naturalWidth(svgWith({}))).toBe(0);
  });
});

describe('the diagram palette', () => {
  it('takes its colours from the theme tokens, so light and dark both look at home', () => {
    const styles = {
      getPropertyValue: (name: string) => (name === '--orbit-accent' ? '#4d57bd' : ''),
    } as unknown as CSSStyleDeclaration;

    const light = mermaidConfig(styles, false);
    const dark = mermaidConfig(styles, true);

    expect(light.themeVariables?.['primaryBorderColor']).toBe('#4d57bd');
    expect(light.themeVariables?.['textColor']).not.toBe(dark.themeVariables?.['textColor']);
    expect(dark.darkMode).toBe(true);
    expect(light.securityLevel).toBe('strict');
    expect(light.startOnLoad).toBe(false);
  });
});

describe('the diagram chrome', () => {
  it('offers a viewer for a diagram that outgrew the column', async () => {
    const host = blockFrom(DIAGRAM);
    const { renderer } = fakeMermaid(SVG);
    const opened: DiagramOpenDetail[] = [];
    host.addEventListener(DIAGRAM_OPEN_EVENT, (event) => {
      opened.push((event as CustomEvent<DiagramOpenDetail>).detail);
    });

    await drawDiagrams(host, 'light', () => Promise.resolve(renderer));
    host.querySelector<HTMLButtonElement>('[data-mermaid-expand]')?.click();

    expect(opened).toHaveLength(1);
    expect(opened[0]?.svg).toContain('graphics-hint');
    expect(opened[0]?.label).toBe(DIAGRAM_LABEL);
  });

  it('reveals the toggle on hover and keeps it visible while the source is showing', () => {
    expect(docProseClassName).toContain(
      '[&_[data-mermaid]:hover_[data-mermaid-toggle]]:opacity-100',
    );
    expect(docProseClassName).toContain(
      '[&_[data-mermaid][data-mermaid-view=source]_[data-mermaid-toggle]]:opacity-100',
    );
  });
});
