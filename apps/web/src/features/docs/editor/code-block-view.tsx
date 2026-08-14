'use client';

import { MERMAID_LANGUAGE } from '@orbit/services/markdown';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { DIAGRAM_FAILED, renderDiagram } from '../mermaid.ts';

export const PREVIEW_DEBOUNCE_MS = 300;
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

  return (
    <div
      contentEditable={false}
      data-testid="mermaid-preview"
      className={cn(
        'mb-2 flex min-h-24 items-center justify-center overflow-x-auto rounded-lg',
        'border border-border bg-surface px-4 py-5',
        '[&_svg]:h-auto [&_svg]:max-w-full',
      )}
    >
      {svg === null ? (
        <p className={cn('m-0 text-2xs', note === DIAGRAM_FAILED ? 'text-danger' : 'text-faint')}>
          {note}
        </p>
      ) : (
        <div
          role="img"
          aria-label="Diagram preview"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid sanitizes its own output at the strict security level
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
