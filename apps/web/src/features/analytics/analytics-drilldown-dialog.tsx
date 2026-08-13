'use client';

import type {
  AnalyticsDrilldownCohort,
  AnalyticsDrilldownQuery,
  AnalyticsQuery,
} from '@orbit/shared/validators';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReactNode, RefObject } from 'react';
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
  const firstPage = result.data?.pages[0];
  const exportQuery = drilldownQuery(query, cohort);
  const exportHref = `/api/analytics/export?${searchParamsForDrilldown(exportQuery).toString()}`;
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
        <ul className="divide-y divide-border pr-3">
          {issues.map((issue) => (
            <li className="py-3" key={issue.id}>
              <a
                className="block rounded-md px-2 py-1 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                href={`/issue/${issue.identifier}`}
              >
                <span className="text-faint text-xs">{issue.identifier}</span>
                <span className="ml-2 text-sm text-text">{issue.title}</span>
                <span className="mt-1 flex flex-wrap gap-2 text-faint text-xs">
                  <span>{issue.state.name}</span>
                  {issue.assignee === null ? null : <span>{issue.assignee.name}</span>}
                  {issue.project === null ? null : <span>{issue.project.name}</span>}
                  {issue.estimate === null ? null : <span>{issue.estimate} pts</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
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
              : `${firstPage.total} matching issues, ${firstPage.totalValue} in the selected measure.`}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="items-center justify-between">
          <a className="text-accent text-xs hover:underline" href={exportHref}>
            Export CSV
          </a>
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
