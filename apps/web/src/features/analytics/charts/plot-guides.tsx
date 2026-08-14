interface PlotGuidesProps {
  readonly width: number;
  readonly height: number;
  readonly plotHeight?: number;
  readonly maxLabel: string;
  readonly startLabel?: string;
  readonly endLabel?: string;
}

export function PlotGuides({
  width,
  height,
  plotHeight = height,
  maxLabel,
  startLabel,
  endLabel,
}: PlotGuidesProps) {
  return (
    <g>
      {[6, plotHeight / 2, plotHeight - 6].map((y) => (
        <line
          data-testid="plot-grid-line"
          key={y}
          stroke="var(--color-border)"
          strokeDasharray={y === plotHeight - 6 ? undefined : '2 3'}
          vectorEffect="non-scaling-stroke"
          x1="6"
          x2={width - 6}
          y1={y}
          y2={y}
        />
      ))}
      <text data-testid="plot-y-max" fill="var(--color-text-faint)" fontSize="7" x="8" y="14">
        {maxLabel}
      </text>
      {startLabel === undefined ? null : (
        <text
          data-testid="plot-x-start"
          fill="var(--color-text-faint)"
          fontSize="7"
          textAnchor="start"
          x="6"
          y={height - 2}
        >
          {startLabel}
        </text>
      )}
      {endLabel === undefined ? null : (
        <text
          data-testid="plot-x-end"
          fill="var(--color-text-faint)"
          fontSize="7"
          textAnchor="end"
          x={width - 6}
          y={height - 2}
        >
          {endLabel}
        </text>
      )}
    </g>
  );
}
