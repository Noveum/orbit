import type { Measure } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { Download } from 'lucide-react';
import { AnalyticsCard } from './analytics-card.tsx';
import { loadBreakdown } from './data.ts';
import { STATE_GROUP_ORDER, stateGroupLabel } from './labels.ts';

export async function BreakdownSection({
  principal,
  measure,
}: {
  readonly principal: Principal;
  readonly measure: Measure;
}) {
  const breakdown = await loadBreakdown(principal, measure);
  const segmentKeys = STATE_GROUP_ORDER.filter((key) => key in breakdown.schema);

  return (
    <AnalyticsCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-dense text-text">Assignee breakdown by state</h2>
        <a
          href={`/api/analytics/export?dimension=assignee&measure=${measure}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-2xs text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
        >
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-xs">
          <thead>
            <tr className="border-border border-b text-2xs text-faint uppercase">
              <th scope="col" className="px-2 py-2 text-left font-medium">
                Assignee
              </th>
              {segmentKeys.map((key) => (
                <th key={key} scope="col" className="px-2 py-2 text-right font-medium">
                  {stateGroupLabel(key)}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.data.length === 0 ? (
              <tr>
                <td colSpan={segmentKeys.length + 2} className="px-2 py-4 text-center text-faint">
                  No issues in range.
                </td>
              </tr>
            ) : (
              breakdown.data.map((row) => (
                <tr key={row.key} className="border-border border-b last:border-b-0">
                  <td className="px-2 py-1.5 text-muted">{row.name}</td>
                  {segmentKeys.map((key) => (
                    <td key={key} className="px-2 py-1.5 text-right text-muted tabular">
                      {row.values[key] ?? 0}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-medium text-text tabular">
                    {row.total}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AnalyticsCard>
  );
}
