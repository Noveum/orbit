'use client';

import { MERMAID_LANGUAGE } from '@orbit/services/markdown';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { Maximize2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { DiagramViewer } from '../diagram-viewer.tsx';
import {
  DIAGRAM_FAILED,
  fitsTheColumn,
  inkLabels,
  naturalWidth,
  renderDiagram,
} from '../mermaid.ts';

export const PREVIEW_DEBOUNCE_MS = 300;
export const PREVIEW_PADDING = 32;
export const EMPTY_DIAGRAM = 'Write mermaid below and the diagram appears here.';

export function useDiagram(source: string, theme: string): { svg: string | null; note: string } {
  const [svg, setSvg] = useState<string | null>(null);
  const [note, setNote] = useState(EMPTY_DIAGRAM);

  useEffect(() => {
    if (source.trim().length === 0) {
      setSvg(null);
      setNote(EMPTY_DIAGRAM);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      renderDiagram(source, theme, document)
        .then((drawn) => {
          if (!live) return;
          setSvg(drawn);
          setNote(drawn === null ? DIAGRAM_FAILED : '');
        })
        .catch(() => {
          if (!live) return;
          setSvg(null);
          setNote(DIAGRAM_FAILED);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, theme]);

  return { svg, note };
}

function DiagramPreview({ source }: { readonly source: string }) {
  const { resolvedTheme } = useTheme();
  const { svg, note } = useDiagram(source, resolvedTheme === 'dark' ? 'dark' : 'light');
  const canvas = useRef<HTMLDivElement | null>(null);
  const [fits, setFits] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    const node = canvas.current;
    const drawn = svg === null ? null : (node?.querySelector('svg') ?? null);
    if (node === null || drawn === null) return;
    inkLabels(node);

    const decide = () =>
      setFits(fitsTheColumn(naturalWidth(drawn), node.clientWidth - PREVIEW_PADDING));
    decide();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(decide);
    observer.observe(node);
    return () => observer.disconnect();
  }, [svg]);

  return (
    <div
      ref={canvas}
      contentEditable={false}
      data-testid="mermaid-preview"
      className={cn(
        'group/preview relative mb-2 min-h-24 overflow-x-auto rounded-lg border border-border bg-surface px-4 py-5',
        '[&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto',
        fits ? '[&_svg]:max-w-full' : '[&_svg]:max-w-none',
      )}
    >
      {svg === null ? null : (
        <button
          type="button"
          aria-label="Open the diagram in a viewer"
          data-testid="mermaid-preview-expand"
          onClick={() => setOpened(svg)}
          className={cn(
            'absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-sm',
            'border border-border bg-surface text-muted opacity-0',
            'transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
            'group-hover/preview:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none',
          )}
        >
          <Maximize2 className="size-3.5" aria-hidden="true" />
        </button>
      )}
      <DiagramViewer svg={opened} label="Diagram" onClose={() => setOpened(null)} />
      {svg === null ? (
        <p className={cn('m-0 text-2xs', note === DIAGRAM_FAILED ? 'text-danger' : 'text-faint')}>
          {note}
        </p>
      ) : (
        <div
          role="img"
          aria-label="Diagram preview"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the drawn svg is sanitised in renderDiagram
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}

export function CodeBlockView({ node }: NodeViewProps) {
  const language = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';
  const drawsDiagram = language === MERMAID_LANGUAGE;

  return (
    <NodeViewWrapper
      data-code-view=""
      data-language={language}
      className={cn('relative', drawsDiagram && 'my-5')}
    >
      {drawsDiagram ? <DiagramPreview source={node.textContent} /> : null}
      <pre className={drawsDiagram ? 'my-0' : undefined}>
        <NodeViewContent<'code'>
          as="code"
          className={language.length === 0 ? 'hljs' : `hljs language-${language}`}
        />
      </pre>
      {drawsDiagram ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 bottom-3 font-mono text-2xs text-faint"
        >
          {MERMAID_LANGUAGE}
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}
