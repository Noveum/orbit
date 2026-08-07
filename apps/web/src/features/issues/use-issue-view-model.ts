'use client';

import { isEmptyFilter } from '@orbit/shared/filters';
import { useMemo } from 'react';
import { applyDisplayFilters } from '@/features/filters/display-filter.ts';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { groupIssues, mergeStatesByName, remapTotals } from '@/features/filters/grouping.ts';
import type { ViewConfig } from '@/features/filters/view-config.ts';
import { facetsSearch, summarySearch } from '@/lib/query/issue-search.ts';
import type { Issue, IssueFacets, WorkflowState } from '@/lib/query/schemas.ts';
import { useIssueFacets, useIssueSummary } from '@/lib/query/use-issues.ts';
import { statesForTeam, useWorkspace } from './workspace-provider.tsx';

export interface IssueViewModel {
  readonly groups: readonly IssueGroup[];
  readonly states: readonly WorkflowState[];
  readonly shownCount: number;
  readonly total: number;
  readonly hiddenByFilters: number;
  readonly hiddenByDisplay: number;
  readonly filtered: boolean;
  readonly facets: IssueFacets['facets'] | undefined;
}

export interface IssueViewModelInput {
  readonly teamId: string | null;
  readonly config: ViewConfig;
  readonly issues: readonly Issue[];
  readonly scopeToTeam?: boolean;
  readonly scope?: Readonly<Record<string, string>>;
}

export function useIssueViewModel({
  teamId,
  config,
  issues,
  scopeToTeam = true,
  scope,
}: IssueViewModelInput): IssueViewModel {
  const workspace = useWorkspace();
  const filtered = !isEmptyFilter(config.filter);

  const enabled = !scopeToTeam || teamId !== null;
  const search = summarySearch(
    scopeToTeam ? teamId : null,
    { filter: config.filter, orderBy: config.orderBy },
    config.groupBy,
    scope,
  );
  const summary = useIssueSummary(search, enabled);
  const facets = useIssueFacets(facetsSearch(scopeToTeam ? teamId : null, scope), enabled);

  const merged = useMemo(
    () =>
      scopeToTeam
        ? null
        : mergeStatesByName(
            [...workspace.states].sort((left, right) => left.position - right.position),
          ),
    [workspace.states, scopeToTeam],
  );

  const states = useMemo(
    () => merged?.states ?? statesForTeam(workspace.states, teamId),
    [merged, workspace.states, teamId],
  );

  const shown = useMemo(
    () => applyDisplayFilters(issues, config.display, workspace.stateById),
    [issues, config.display, workspace.stateById],
  );

  const cycles = useMemo(
    () =>
      scopeToTeam && teamId !== null
        ? workspace.cycles.filter((cycle) => cycle.teamId === teamId)
        : workspace.cycles,
    [workspace.cycles, teamId, scopeToTeam],
  );

  const remap = merged !== null && config.groupBy === 'state' ? merged.idMap : undefined;

  const groupTotals = useMemo(
    () =>
      remap === undefined
        ? summary.data?.groupTotals
        : remapTotals(summary.data?.groupTotals, remap),
    [summary.data?.groupTotals, remap],
  );

  const groups = useMemo(
    () =>
      groupIssues(
        shown.issues,
        config.groupBy,
        {
          states,
          members: workspace.members,
          projects: workspace.projects,
          cycles,
          labels: workspace.labels,
        },
        {
          showEmptyGroups: config.display.showEmptyGroups ?? false,
          ordering: config.orderBy,
          subGroupBy: config.subGroupBy,
          totals: groupTotals,
          remap: config.groupBy === 'state' ? remap : undefined,
        },
      ),
    [
      shown.issues,
      config.groupBy,
      config.display.showEmptyGroups,
      config.orderBy,
      config.subGroupBy,
      states,
      cycles,
      workspace.members,
      workspace.projects,
      workspace.labels,
      groupTotals,
      remap,
    ],
  );

  const total = summary.data?.total ?? shown.issues.length;

  return {
    groups,
    states,
    shownCount: shown.issues.length,
    total,
    hiddenByFilters:
      filtered && summary.data !== undefined && facets.data !== undefined
        ? Math.max(0, facets.data.scopeTotal - summary.data.total)
        : 0,
    hiddenByDisplay: shown.hidden,
    filtered,
    facets: facets.data?.facets,
  };
}
