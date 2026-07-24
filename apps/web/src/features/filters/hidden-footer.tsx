'use client';

export interface HiddenFooterProps {
  readonly hiddenByFilters: number;
  readonly hiddenByDisplay: number;
  readonly onClearFilters: () => void;
  readonly onRevealDisplay: () => void;
}

function issueCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'issue' : 'issues'}`;
}

export function HiddenFooter({
  hiddenByFilters,
  hiddenByDisplay,
  onClearFilters,
  onRevealDisplay,
}: HiddenFooterProps) {
  if (hiddenByFilters <= 0 && hiddenByDisplay <= 0) return null;

  return (
    <div
      className="flex shrink-0 flex-col items-center gap-0.5 border-border border-t px-3 py-1.5 text-2xs"
      data-testid="hidden-footer"
    >
      {hiddenByFilters > 0 ? (
        <p className="flex items-center gap-1.5" data-testid="hidden-by-filters">
          <span data-numeric className="text-text">
            {issueCount(hiddenByFilters)}
          </span>
          <span className="text-faint">hidden by filters</span>
          <button
            type="button"
            onClick={onClearFilters}
            data-testid="footer-clear-filters"
            className="rounded-sm px-1 text-accent underline-offset-2 transition-opacity duration-[var(--duration-fast)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Clear filters
          </button>
        </p>
      ) : null}

      {hiddenByDisplay > 0 ? (
        <p className="flex items-center gap-1.5" data-testid="hidden-by-display">
          <span data-numeric className="text-text">
            {issueCount(hiddenByDisplay)}
          </span>
          <span className="text-faint">hidden by display options</span>
          <button
            type="button"
            onClick={onRevealDisplay}
            data-testid="footer-reveal-display"
            className="rounded-sm px-1 text-accent underline-offset-2 transition-opacity duration-[var(--duration-fast)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Show them
          </button>
        </p>
      ) : null}
    </div>
  );
}
