import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@orbit/shared/constants';
import type { GroupByField, IssueOrdering } from '@orbit/shared/filters';
import type { Cycle, Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';

export const UNGROUPED_ID = 'none';

export interface GroupContext {
  readonly states: readonly WorkflowState[];
  readonly members: readonly Member[];
  readonly projects: readonly Project[];
  readonly cycles: readonly Cycle[];
  readonly labels: readonly Label[];
}

export interface GroupDefinition {
  readonly id: string;
  readonly title: string;
  readonly color: string | null;
  readonly category: string | null;
}

export interface IssueSubGroup extends GroupDefinition {
  readonly issues: readonly Issue[];
}

export interface IssueGroup extends GroupDefinition {
  readonly issues: readonly Issue[];
  readonly subGroups: readonly IssueSubGroup[];
  readonly total: number;
}

export const PRIORITY_ORDER: readonly Priority[] = [1, 2, 3, 4, 0];

const ESTIMATE_ORDER = [0, 1, 2, 3, 5, 8, 13];

function unassigned(title: string): GroupDefinition {
  return { id: UNGROUPED_ID, title, color: null, category: null };
}

export function groupDefinitions(groupBy: GroupByField, context: GroupContext): GroupDefinition[] {
  switch (groupBy) {
    case 'state':
      return context.states.map((state) => ({
        id: state.id,
        title: state.name,
        color: state.color,
        category: state.category,
      }));
    case 'assignee':
      return [
        ...context.members.map((member) => ({
          id: member.id,
          title: member.name,
          color: null,
          category: null,
        })),
        unassigned('No assignee'),
      ];
    case 'creator':
      return context.members.map((member) => ({
        id: member.id,
        title: member.name,
        color: null,
        category: null,
      }));
    case 'priority':
      return PRIORITY_ORDER.map((priority) => ({
        id: String(priority),
        title: PRIORITY_LABELS[priority],
        color: null,
        category: null,
      }));
    case 'estimate':
      return [
        ...ESTIMATE_ORDER.map((points) => ({
          id: String(points),
          title: points === 1 ? '1 Point' : `${points} Points`,
          color: null,
          category: null,
        })),
        unassigned('No estimate'),
      ];
    case 'project':
      return [
        ...context.projects.map((project) => ({
          id: project.id,
          title: project.name,
          color: project.color,
          category: null,
        })),
        unassigned('No project'),
      ];
    case 'label':
      return [
        ...context.labels.map((label) => ({
          id: label.id,
          title: label.name,
          color: label.color,
          category: null,
        })),
        unassigned('No label'),
      ];
    case 'cycle':
      return [
        ...context.cycles.map((cycle) => ({
          id: cycle.id,
          title: cycle.name.length === 0 ? `Cycle ${cycle.number}` : cycle.name,
          color: null,
          category: null,
        })),
        unassigned('No cycle'),
      ];
    case 'none':
      return [{ id: 'all', title: 'All issues', color: null, category: null }];
  }
}

export function groupKeysOf(issue: Issue, groupBy: GroupByField): readonly string[] {
  switch (groupBy) {
    case 'state':
      return [issue.stateId];
    case 'assignee':
      return [issue.assigneeId ?? UNGROUPED_ID];
    case 'creator':
      return [issue.creatorId];
    case 'priority':
      return [String(issue.priority)];
    case 'estimate':
      return [issue.estimate === null ? UNGROUPED_ID : String(issue.estimate)];
    case 'project':
      return [issue.projectId ?? UNGROUPED_ID];
    case 'cycle':
      return [issue.cycleId ?? UNGROUPED_ID];
    case 'label': {
      const ids = Array.isArray(issue.labelIds) ? issue.labelIds : [];
      return ids.length === 0 ? [UNGROUPED_ID] : ids;
    }
    case 'none':
      return ['all'];
  }
}

export interface GroupOptions {
  readonly showEmptyGroups: boolean;
  readonly ordering: IssueOrdering;
  readonly subGroupBy?: GroupByField;
  readonly totals?: Readonly<Record<string, number>> | undefined;
  readonly remap?: ReadonlyMap<string, string> | undefined;
}

function bucket(
  issues: readonly Issue[],
  groupBy: GroupByField,
  remap: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, readonly Issue[]> {
  const buckets = new Map<string, Issue[]>();
  for (const issue of issues) {
    for (const raw of groupKeysOf(issue, groupBy)) {
      const key = remap?.get(raw) ?? raw;
      const current = buckets.get(key);
      if (current === undefined) buckets.set(key, [issue]);
      else current.push(issue);
    }
  }
  return buckets;
}

export interface MergedStates {
  readonly states: readonly WorkflowState[];
  readonly idMap: ReadonlyMap<string, string>;
}

export function mergeStatesByName(states: readonly WorkflowState[]): MergedStates {
  const canonical = new Map<string, WorkflowState>();
  const idMap = new Map<string, string>();
  for (const state of states) {
    const key = `${state.category}:${state.name.trim().toLowerCase()}`;
    const existing = canonical.get(key);
    if (existing === undefined) canonical.set(key, { ...state, id: key });
    idMap.set(state.id, key);
  }
  const merged = [...canonical.values()].sort((left, right) => left.position - right.position);
  return { states: merged, idMap };
}

export function remapTotals(
  totals: Readonly<Record<string, number>> | undefined,
  idMap: ReadonlyMap<string, string>,
): Record<string, number> | undefined {
  if (totals === undefined) return undefined;
  const merged: Record<string, number> = {};
  for (const [id, value] of Object.entries(totals)) {
    const key = idMap.get(id) ?? id;
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

function definitionsWithExtras(
  groupBy: GroupByField,
  context: GroupContext,
  keys: Iterable<string>,
): GroupDefinition[] {
  const definitions = groupDefinitions(groupBy, context);
  const known = new Set(definitions.map((definition) => definition.id));
  const extras = [...keys]
    .filter((key) => !known.has(key))
    .map((key) => ({ id: key, title: 'Other', color: null, category: null }));
  return [...definitions, ...extras];
}

function ordered(issues: readonly Issue[], ordering: IssueOrdering): readonly Issue[] {
  return ordering === 'manual' ? sortIssues(issues) : issues;
}

export function groupIssues(
  issues: readonly Issue[],
  groupBy: GroupByField,
  context: GroupContext,
  options: GroupOptions,
): IssueGroup[] {
  const buckets = bucket(issues, groupBy, options.remap);
  const subGroupBy = options.subGroupBy ?? 'none';

  return definitionsWithExtras(groupBy, context, buckets.keys()).flatMap((definition) => {
    const rows = buckets.get(definition.id) ?? [];
    const total = options.totals?.[definition.id] ?? rows.length;
    if (total === 0 && rows.length === 0 && !options.showEmptyGroups) return [];
    const sorted = ordered(rows, options.ordering);
    const subGroups =
      subGroupBy === 'none' || subGroupBy === groupBy
        ? []
        : subGroupsOf(sorted, subGroupBy, context, options);
    return [{ ...definition, issues: sorted, subGroups, total }];
  });
}

function subGroupsOf(
  issues: readonly Issue[],
  subGroupBy: GroupByField,
  context: GroupContext,
  options: GroupOptions,
): IssueSubGroup[] {
  const buckets = bucket(issues, subGroupBy, options.remap);
  return definitionsWithExtras(subGroupBy, context, buckets.keys()).flatMap((definition) => {
    const rows = buckets.get(definition.id) ?? [];
    if (rows.length === 0) return [];
    return [{ ...definition, issues: ordered(rows, options.ordering) }];
  });
}

export function priorityLabel(priority: number): string {
  const known = PRIORITIES.find((entry) => entry === priority);
  return known === undefined ? 'No priority' : PRIORITY_LABELS[known];
}
