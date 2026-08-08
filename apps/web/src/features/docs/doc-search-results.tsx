'use client';

import { FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';
import { breadcrumbOf } from './doc-tree-model.ts';
import { MarkedPassage, MatchedText } from './search-highlight.tsx';

export interface DocSearchGroups {
  readonly titles: readonly DocSummary[];
  readonly bodies: readonly DocSummary[];
}

export function groupResults(docs: readonly DocSummary[]): DocSearchGroups {
  return {
    titles: docs.filter((doc) => doc.titleMatch),
    bodies: docs.filter((doc) => !doc.titleMatch),
  };
}

export interface DocSearchResultsProps {
  readonly docs: readonly DocSummary[];
  readonly collections: readonly DocCollection[];
  readonly term: string;
  readonly searching: boolean;
  readonly activeDocId: string | null;
  readonly onNavigate: () => void;
}

export function DocSearchResults({
  docs,
  collections,
  term,
  searching,
  activeDocId,
  onNavigate,
}: DocSearchResultsProps) {
  const groups = useMemo(() => groupResults(docs), [docs]);
  const ordered = useMemo(() => [...groups.titles, ...groups.bodies], [groups]);
  const [selection, setSelection] = useState({ term, index: 0 });
  const cursor = selection.term === term ? selection.index : 0;

  const setCursor = useCallback(
    (next: number | ((current: number) => number)) => {
      setSelection((current) => {
        const base = current.term === term ? current.index : 0;
        return { term, index: typeof next === 'function' ? next(base) : next };
      });
    },
    [term],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (ordered.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((index) => Math.min(index + 1, ordered.length - 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((index) => Math.max(index - 1, 0));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ordered.length, setCursor]);

  if (docs.length === 0) {
    return (
      <section data-testid="doc-search-results" className="flex flex-col gap-1 px-2 py-3">
        <p className="text-dense text-faint">
          {searching ? 'Searching…' : `Nothing matches “${term.trim()}”.`}
        </p>
      </section>
    );
  }

  return (
    <section data-testid="doc-search-results" className="flex flex-col gap-3">
      {searching ? (
        <span className="flex items-center gap-1.5 px-2 text-2xs text-faint">
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Searching
        </span>
      ) : null}

      <ResultGroup
        id="titles"
        label="Titles"
        entries={groups.titles}
        offset={0}
        cursor={cursor}
        term={term}
        docs={docs}
        collections={collections}
        activeDocId={activeDocId}
        onNavigate={onNavigate}
        onHover={setCursor}
      />
      <ResultGroup
        id="bodies"
        label="In the body"
        entries={groups.bodies}
        offset={groups.titles.length}
        cursor={cursor}
        term={term}
        docs={docs}
        collections={collections}
        activeDocId={activeDocId}
        onNavigate={onNavigate}
        onHover={setCursor}
      />
    </section>
  );
}

function ResultGroup({
  id,
  label,
  entries,
  offset,
  cursor,
  term,
  docs,
  collections,
  activeDocId,
  onNavigate,
  onHover,
}: {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly DocSummary[];
  readonly offset: number;
  readonly cursor: number;
  readonly term: string;
  readonly docs: readonly DocSummary[];
  readonly collections: readonly DocCollection[];
  readonly activeDocId: string | null;
  readonly onNavigate: () => void;
  readonly onHover: (index: number) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div data-testid={`doc-search-${id}`} className="flex flex-col gap-0.5">
      <p className="px-2 font-medium text-2xs text-faint uppercase tracking-wide">{label}</p>
      {entries.map((doc, index) => {
        const trail = breadcrumbOf(docs, collections, doc.id);
        const selected = cursor === offset + index;
        return (
          <Link
            key={doc.id}
            href={`/docs/${doc.id}`}
            data-testid={`doc-row-${doc.id}`}
            data-selected={selected}
            aria-current={activeDocId === doc.id ? 'page' : undefined}
            onMouseMove={() => onHover(offset + index)}
            onClick={onNavigate}
            className={cn(
              'flex flex-col gap-0.5 rounded-md px-2 py-1.5',
              'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
              selected ? 'bg-surface-2' : '',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-dense text-text">
              <FileText className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                <MatchedText text={doc.title} term={term} />
              </span>
            </span>
            {trail.length === 0 ? null : (
              <span className="truncate pl-5 text-2xs text-faint">{trail.join(' / ')}</span>
            )}
            {doc.snippet.length === 0 ? null : (
              <span
                data-testid={`doc-snippet-${doc.id}`}
                className="line-clamp-2 pl-5 text-2xs text-muted leading-snug"
              >
                <MarkedPassage passage={doc.snippet} term={term} />
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
