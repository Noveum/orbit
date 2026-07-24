import { cn } from '@/lib/cn.ts';

export interface ChartTableProps {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<readonly (string | number)[]>;
  readonly summaryLabel?: string;
  readonly className?: string;
}

export function ChartTable({ caption, columns, rows, summaryLabel, className }: ChartTableProps) {
  return (
    <details className={cn('group text-2xs', className)}>
      <summary className="cursor-pointer list-none text-faint transition-colors duration-[var(--duration-fast)] hover:text-muted">
        <span className="underline decoration-dotted underline-offset-2">
          {summaryLabel ?? 'Show data table'}
        </span>
      </summary>
      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-2xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-border border-b text-faint">
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(
                    'px-2 py-1.5 font-medium',
                    index === 0 ? 'text-left' : 'text-right',
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={String(row[0] ?? rowIndex)}
                className="border-border border-b last:border-b-0"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${String(row[0] ?? rowIndex)}-${columns[cellIndex] ?? cellIndex}`}
                    className={cn(
                      'px-2 py-1.5',
                      cellIndex === 0 ? 'text-left text-muted' : 'text-right text-muted tabular',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
