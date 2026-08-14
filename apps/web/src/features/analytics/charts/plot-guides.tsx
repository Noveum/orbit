interface PlotTick {
  readonly x: number;
  readonly label: string;
  readonly testId?: string;
}

interface PlotGuidesProps {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly max: number;
  readonly valueFormatter: (value: number) => string;
  readonly xTicks: readonly PlotTick[];
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
}

function yTickTestId(index: number): string | undefined {
  if (index === 0) return 'plot-y-max';
  if (index === 2) return 'plot-y-zero';
  return undefined;
}

export function PlotGuides({
  width,
  height,
  left,
  right,
  top,
  bottom,
  max,
  valueFormatter,
  xTicks,
  xAxisLabel,
  yAxisLabel,
}: PlotGuidesProps) {
  const plotBottom = height - bottom;
  const plotHeight = plotBottom - top;
  const ticks = [max, max / 2, 0];
  return (
    <g>
      {ticks.map((value, index) => {
        const y = top + (index * plotHeight) / 2;
        return (
          <g key={value}>
            <line
              data-testid="plot-grid-line"
              stroke="var(--color-border)"
              strokeDasharray={index === 2 ? undefined : '3 4'}
              vectorEffect="non-scaling-stroke"
              x1={left}
              x2={width - right}
              y1={y}
              y2={y}
            />
            <text
              data-testid={yTickTestId(index)}
              fill="var(--color-faint)"
              fontSize="11"
              textAnchor="end"
              x={left - 10}
              y={y + 4}
            >
              {valueFormatter(value)}
            </text>
          </g>
        );
      })}
      {xTicks.map((tick) => (
        <g key={`${tick.x}-${tick.label}`}>
          <line
            stroke="var(--color-border-strong)"
            vectorEffect="non-scaling-stroke"
            x1={tick.x}
            x2={tick.x}
            y1={plotBottom}
            y2={plotBottom + 4}
          />
          <text
            data-testid={tick.testId}
            fill="var(--color-faint)"
            fontSize="10"
            textAnchor="middle"
            x={tick.x}
            y={plotBottom + 18}
          >
            {tick.label}
          </text>
        </g>
      ))}
      <text
        data-testid="plot-x-axis-label"
        fill="var(--color-muted)"
        fontSize="11"
        fontWeight="500"
        textAnchor="middle"
        x={(left + width - right) / 2}
        y={height - 2}
      >
        {xAxisLabel}
      </text>
      <text
        data-testid="plot-y-axis-label"
        fill="var(--color-muted)"
        fontSize="11"
        fontWeight="500"
        textAnchor="middle"
        transform={`rotate(-90 12 ${(top + plotBottom) / 2})`}
        x="12"
        y={(top + plotBottom) / 2}
      >
        {yAxisLabel}
      </text>
    </g>
  );
}
