import { cn } from '@/lib/cn.ts';
import { ChartTable } from './chart-table.tsx';

export interface HistogramProps {
  readonly title: string;
  readonly values: readonly number[];
  readonly p50: number;
  readonly p85: number;
  readonly unit: string;
  readonly binCount?: number;
  readonly className?: string;
}

interface Bin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

function buildBins(
  values: readonly number[],
  binCount: number,
): { bins: Bin[]; min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = span / binCount;
  const bins: Bin[] = Array.from({ length: binCount }, (_, index) => ({
    from: min + width * index,
    to: min + width * (index + 1),
    count: 0,
  }));
  for (const value of values) {
    const raw = Math.floor((value - min) / width);
    const index = Math.min(binCount - 1, Math.max(0, raw));
    const bin = bins[index];
    if (bin !== undefined) bins[index] = { ...bin, count: bin.count + 1 };
  }
  return { bins, min, max };
}

function markerPercent(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export function Histogram({
  title,
  values,
  p50,
  p85,
  unit,
  binCount = 8,
  className,
}: HistogramProps) {
  const format = (value: number): string => value.toFixed(1);

  if (values.length === 0) {
    return (
      <figure className={cn('flex flex-col gap-2', className)}>
        <figcaption className="font-medium text-dense text-text">{title}</figcaption>
        <p className="py-4 text-center text-faint text-xs">Nothing completed yet.</p>
      </figure>
    );
  }

  const { bins, min, max } = buildBins(values, binCount);
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-dense text-text">{title}</span>
        <span className="flex items-center gap-3 text-2xs text-muted tabular">
          <span>
            <span className="text-faint">p50</span> {format(p50)}
            {unit}
          </span>
          <span>
            <span className="text-faint">p85</span> {format(p85)}
            {unit}
          </span>
        </span>
      </figcaption>
      <div
        className="relative h-24"
        role="img"
        aria-label={`${title}. Median ${format(p50)} ${unit}, 85th percentile ${format(p85)} ${unit}.`}
      >
        <div className="flex h-full items-end gap-0.5">
          {bins.map((bin) => (
            <span
              key={bin.from}
              className="flex-1 rounded-t-sm bg-accent/70"
              style={{ height: `${Math.max(2, Math.round((bin.count / maxCount) * 100))}%` }}
            />
          ))}
        </div>
        <span
          className="absolute inset-y-0 w-px bg-text/60"
          style={{ left: `${markerPercent(p50, min, max)}%` }}
          aria-hidden="true"
        />
        <span
          className="absolute inset-y-0 w-px bg-warning"
          style={{ left: `${markerPercent(p85, min, max)}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex justify-between text-2xs text-faint tabular">
        <span>
          {format(min)}
          {unit}
        </span>
        <span>
          {format(max)}
          {unit}
        </span>
      </div>
      <ChartTable
        caption={`${title} distribution`}
        columns={[`Range (${unit})`, 'Count']}
        rows={bins.map((bin) => [`${format(bin.from)} to ${format(bin.to)}`, bin.count])}
      />
    </figure>
  );
}
