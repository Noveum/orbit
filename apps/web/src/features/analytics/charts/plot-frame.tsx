import type { ReactNode } from 'react';

interface PlotLegend {
  readonly id: string;
  readonly label: string;
  readonly dashed?: boolean;
  readonly color?: number;
  readonly swatchVar?: string;
}

interface PlotFrameProps {
  readonly label: string;
  readonly legends: readonly PlotLegend[];
  readonly children: ReactNode;
  readonly table?: ReactNode;
  readonly tooltip?: ReactNode;
  readonly announcement?: string;
  readonly dataCount?: number;
}

export function PlotFrame({
  label,
  legends,
  children,
  table,
  tooltip,
  announcement,
  dataCount,
}: PlotFrameProps) {
  return (
    <figure className="grid gap-3">
      <figcaption
        className={
          legends.length === 0 ? 'sr-only' : 'flex flex-wrap items-center justify-between gap-2'
        }
      >
        <span className="font-medium text-sm text-text">{label}</span>
        <span className="flex flex-wrap items-center gap-3 text-faint text-xs">
          {legends.map((legend, index) => (
            <span className="inline-flex items-center gap-1.5" key={legend.id}>
              <svg aria-hidden="true" height="6" viewBox="0 0 20 6" width="20">
                <line
                  data-testid={`plot-legend-${legend.id}`}
                  stroke={
                    legend.swatchVar ?? `var(--analytics-series-${legend.color ?? (index % 4) + 1})`
                  }
                  strokeDasharray={legend.dashed ? '5 3' : undefined}
                  strokeLinecap="round"
                  strokeWidth="2"
                  x1="1"
                  x2="19"
                  y1="3"
                  y2="3"
                />
              </svg>
              {legend.label}
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
      {table === undefined ? null : (
        <details className="group rounded-md border border-border bg-surface-2/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-muted text-xs hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            View data{dataCount === undefined ? '' : ` (${dataCount} rows)`}
          </summary>
          <div className="border-border border-t p-2">{table}</div>
        </details>
      )}
    </figure>
  );
}
