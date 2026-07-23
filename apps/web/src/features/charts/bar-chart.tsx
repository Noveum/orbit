import { cn } from '@/lib/cn.ts';
import { ChartTable } from './chart-table.tsx';

export interface BarDatum {
  readonly key: string;
  readonly name: string;
  readonly value: number;
}

export interface BarChartProps {
  readonly title: string;
  readonly description: string;
  readonly data: readonly BarDatum[];
  readonly valueLabel: string;
  readonly maxBars?: number;
  readonly emptyLabel?: string;
  readonly className?: string;
}

export function BarChart({
  title,
  description,
  data,
  valueLabel,
  maxBars = 8,
  emptyLabel = 'No data in range.',
  className,
}: BarChartProps) {
  const visible = data.slice(0, maxBars);
  const max = Math.max(1, ...visible.map((datum) => datum.value));

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-dense text-text">{title}</span>
        <span className="text-2xs text-faint uppercase">{valueLabel}</span>
      </figcaption>
      {visible.length === 0 ? (
        <p className="py-4 text-center text-faint text-xs">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((datum) => (
            <li
              key={datum.key}
              className="grid grid-cols-[minmax(4rem,8rem)_1fr_auto] items-center gap-2 text-xs"
            >
              <span className="truncate text-muted" title={datum.name}>
                {datum.name}
              </span>
              <span
                className="block h-2 overflow-hidden rounded-full bg-surface-3"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-full bg-accent transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out-orbit)]"
                  style={{ width: `${Math.round((datum.value / max) * 100)}%` }}
                />
              </span>
              <span className="w-10 text-right text-muted tabular">{datum.value}</span>
            </li>
          ))}
        </ul>
      )}
      {visible.length === 0 ? null : (
        <ChartTable
          caption={description}
          columns={['Name', valueLabel]}
          rows={data.map((datum) => [datum.name, datum.value])}
        />
      )}
    </figure>
  );
}
