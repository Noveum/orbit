'use client';

import { ExternalLink, X } from 'lucide-react';
import type { DuplicateIssueMatch } from '@/lib/query/schemas.ts';
import { StateGlyph } from './state-glyph.tsx';

export interface DuplicateSuggestionsProps {
  readonly duplicates: readonly DuplicateIssueMatch[];
  readonly onDismiss: () => void;
}

export function DuplicateSuggestions({ duplicates, onDismiss }: DuplicateSuggestionsProps) {
  if (duplicates.length === 0) return null;

  return (
    <div
      data-testid="duplicate-suggestions"
      className="flex shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-surface-2/60 p-2.5 text-2xs"
    >
      <div className="flex items-center justify-between font-medium text-muted">
        <span>Similar existing issues ({duplicates.length})</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss similar issues"
          className="rounded p-0.5 text-faint transition-colors hover:text-text"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {duplicates.map((issue) => (
          <li key={issue.id} className="flex items-center justify-between gap-2">
            <a
              href={`/issues/${issue.identifier}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-w-0 items-center gap-1.5 truncate font-medium text-text hover:text-accent"
            >
              <span className="shrink-0 text-faint group-hover:text-accent/80">
                {issue.identifier}
              </span>
              <span className="truncate">{issue.title}</span>
              <ExternalLink
                className="size-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
            </a>
            <div className="flex shrink-0 items-center gap-1 text-faint">
              <StateGlyph category={issue.state.category} color={issue.state.color} />
              <span>{issue.state.name}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
