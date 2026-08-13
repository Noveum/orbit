import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

export interface AnalyticsDataColumn {
  readonly id: string;
  readonly label: string;
  readonly align?: 'left' | 'right';
}

export interface AnalyticsDataRow {
  readonly id: string;
  readonly label: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
}

interface AnalyticsDataTableProps {
  readonly ariaLabel: string;
  readonly columns: readonly AnalyticsDataColumn[];
  readonly rows: readonly AnalyticsDataRow[];
  readonly activeRowId?: string;
  readonly onActivate?: (row: AnalyticsDataRow) => void;
}

export function AnalyticsDataTable({
  ariaLabel,
  columns,
  rows,
  activeRowId,
  onActivate,
}: AnalyticsDataTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table aria-label={ariaLabel} className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-border border-b text-faint">
            {columns.map((column) => (
              <th
                className={cn(
                  'px-2 py-1.5 font-medium',
                  column.align === 'right' ? 'text-right' : 'text-left',
                )}
                key={column.id}
                scope="col"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className={cn(
                'border-border border-b last:border-b-0',
                activeRowId === row.id && 'bg-accent/10',
              )}
              data-active={activeRowId === row.id ? 'true' : 'false'}
              key={row.id}
            >
              {columns.map((column, index) => (
                <td
                  className={cn(
                    'px-2 py-1.5 text-muted tabular',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                  key={column.id}
                >
                  {index === 0 && onActivate !== undefined ? (
                    <button
                      aria-label={`${String(row.cells[column.id] ?? '')}, ${row.label}`}
                      className="rounded-sm text-left text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      onClick={() => onActivate(row)}
                      type="button"
                    >
                      {row.cells[column.id]}
                      <span className="sr-only">, {row.label}</span>
                    </button>
                  ) : (
                    row.cells[column.id]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
