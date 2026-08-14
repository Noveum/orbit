'use client';

import type {
  AnalyticsDrilldownCohort,
  AnalyticsDrilldownQuery,
  AnalyticsQuery,
} from '@orbit/shared/validators';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type ReactNode, type RefObject, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { ScrollArea } from '@/components/ui/scroll-area.tsx';
import { apiFetch, messageOf } from '@/lib/query/fetcher.ts';
import { analyticsKeys } from './analytics-keys.ts';
import { type AnalyticsDrilldownResponse, analyticsDrilldownResponseSchema } from './contracts.ts';
import { searchParamsForDrilldown } from './query-state.ts';

interface AnalyticsDrilldownDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly query: AnalyticsQuery;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

function drilldownQuery(
  query: AnalyticsQuery,
  cohort: AnalyticsDrilldownCohort,
  cursor?: string,
): AnalyticsDrilldownQuery {
  return {
    ...query,
    cohort,
    limit: 50,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

async function loadPage(
  query: AnalyticsDrilldownQuery,
  signal: AbortSignal,
): Promise<AnalyticsDrilldownResponse> {
  return await apiFetch(
    `/api/analytics/drilldown?${searchParamsForDrilldown(query).toString()}`,
    analyticsDrilldownResponseSchema,
    { signal },
  );
}

export function AnalyticsDrilldownDialog({
  open,
  onOpenChange,
  title,
  query,
  cohort,
  returnFocusRef,
}: AnalyticsDrilldownDialogProps) {
  const [updatedAscending, setUpdatedAscending] = useState(false);
  const baseQuery = drilldownQuery(query, cohort);
  const result = useInfiniteQuery({
    queryKey: analyticsKeys.drilldown(baseQuery),
    queryFn: async ({ pageParam, signal }) =>
      await loadPage(
        drilldownQuery(query, cohort, typeof pageParam === 'string' ? pageParam : undefined),
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open,
  });
  const issues = result.data?.pages.flatMap((page) => page.issues) ?? [];
  const sortedIssues = issues.toSorted((left, right) => {
    const order = left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id);
    return updatedAscending ? order : -order;
  });
  const firstPage = result.data?.pages[0];
  let body: ReactNode;
  if (result.isPending) {
    body = <p className="py-12 text-center text-muted text-sm">Loading evidence...</p>;
  } else if (result.isError) {
    body = (
      <div className="py-12 text-center">
        <p className="text-danger text-sm">{messageOf(result.error, 'Evidence could not load.')}</p>
        <Button
          className="mt-3"
          onClick={async () => await result.refetch()}
          size="sm"
          variant="secondary"
        >
          Try again
        </Button>
      </div>
    );
  } else if (issues.length === 0) {
    body = <p className="py-12 text-center text-muted text-sm">No matching issues.</p>;
  } else {
    body = (
      <ScrollArea className="h-[calc(100dvh-12rem)] sm:h-[min(60vh,36rem)]">
        <div className="overflow-x-auto pr-3">
          <table aria-label={`${title} evidence`} className="w-full min-w-3xl text-left text-xs">
            <thead className="sticky top-0 bg-surface text-faint">
              <tr className="border-border border-b">
                <th className="px-2 py-2 font-medium" scope="col">
                  Issue
                </th>
                <th className="px-2 py-2 font-medium" scope="col">
                  State
                </th>
                <th className="px-2 py-2 font-medium" scope="col">
                  Assignee
                </th>
                <th className="px-2 py-2 font-medium" scope="col">
                  Project
                </th>
                <th className="px-2 py-2 text-right font-medium" scope="col">
                  Estimate
                </th>
                <th
                  aria-sort={updatedAscending ? 'ascending' : 'descending'}
                  className="px-2 py-2 text-right font-medium"
                  scope="col"
                >
                  <button
                    className="rounded-sm hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => setUpdatedAscending((value) => !value)}
                    type="button"
                  >
                    Updated
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedIssues.map((issue) => (
                <tr className="border-border border-b last:border-b-0" key={issue.id}>
                  <td className="px-2 py-2">
                    <a
                      className="block rounded-sm text-text hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      href={`/issue/${issue.identifier}`}
                    >
                      <span className="text-faint">{issue.identifier}</span>
                      <span className="ml-2">{issue.title}</span>
                    </a>
                  </td>
                  <td className="px-2 py-2 text-muted">{issue.state.name}</td>
                  <td className="px-2 py-2 text-muted">{issue.assignee?.name ?? 'Unassigned'}</td>
                  <td className="px-2 py-2 text-muted">{issue.project?.name ?? 'No project'}</td>
                  <td className="px-2 py-2 text-right text-muted tabular">
                    {issue.estimate ?? 'None'}
                  </td>
                  <td className="px-2 py-2 text-right text-muted tabular">
                    {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                      new Date(issue.updatedAt),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="h-[100dvh] w-screen max-w-none rounded-none sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)] sm:max-w-4xl sm:rounded-xl"
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current !== undefined && returnFocusRef.current !== null) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {firstPage === undefined
              ? 'Loading issue evidence.'
              : `${firstPage.total} matching issues, ${firstPage.totalValue} in the selected measure. Predicate: ${firstPage.predicate}. Data through ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(firstPage.asOf))}.`}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button asChild size="sm" variant="secondary">
            <a
              download="orbit-analytics-evidence.csv"
              href={`/api/analytics/export?${searchParamsForDrilldown(baseQuery).toString()}`}
            >
              Export exact evidence
            </a>
          </Button>
          {result.hasNextPage ? (
            <Button
              disabled={result.isFetchingNextPage}
              onClick={async () => await result.fetchNextPage()}
              size="sm"
              variant="secondary"
            >
              {result.isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
