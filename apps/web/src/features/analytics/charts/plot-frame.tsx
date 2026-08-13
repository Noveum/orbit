import type { ReactNode } from 'react';

interface PlotFrameProps {
  readonly label: string;
  readonly seriesLabels: readonly string[];
  readonly children: ReactNode;
  readonly table?: ReactNode;
  readonly tooltip?: ReactNode;
  readonly announcement?: string;
}

export function PlotFrame({
  label,
  seriesLabels,
  children,
  table,
  tooltip,
  announcement,
}: PlotFrameProps) {
  return (
    <figure className="grid gap-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-sm text-text">{label}</span>
        <span className="flex flex-wrap items-center gap-3 text-faint text-xs">
          {seriesLabels.map((seriesLabel, index) => (
            <span className="inline-flex items-center gap-1.5" key={seriesLabel}>
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: `var(--analytics-series-${(index % 4) + 1})` }}
              />
              {seriesLabel}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="relative">
        {tooltip}
        {children}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {table}
    </figure>
  );
}
