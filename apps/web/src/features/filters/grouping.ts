import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@orbit/shared/constants';
import type { GroupByField } from '@orbit/shared/filters';
import type { Cycle, Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';
import type { IssueOrdering } from './view-config.ts';

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

export interface IssueGroup extends GroupDefinition {
  readonly issues: readonly Issue[];
}

export const PRIORITY_ORDER: readonly Priority[] = [1, 2, 3, 4, 0];

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
    case 'priority':
      return PRIORITY_ORDER.map((priority) => ({
        id: String(priority),
        title: PRIORITY_LABELS[priority],
        color: null,
        category: null,
      }));
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
          title: cycle.name,
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
    case 'priority':
      return [String(issue.priority)];
    case 'project':
      return [issue.projectId ?? UNGROUPED_ID];
    case 'cycle':
      return [issue.cycleId ?? UNGROUPED_ID];
    case 'label':
      return issue.labelIds.length === 0 ? [UNGROUPED_ID] : issue.labelIds;
    case 'none':
      return ['all'];
  }
}

export interface GroupOptions {
  readonly showEmptyGroups: boolean;
  readonly ordering: IssueOrdering;
}

export function groupIssues(
  issues: readonly Issue[],
  groupBy: GroupByField,
  context: GroupContext,
  options: GroupOptions,
): IssueGroup[] {
  const buckets = new Map<string, Issue[]>();
  for (const issue of issues) {
    for (const key of groupKeysOf(issue, groupBy)) {
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [issue]);
      else bucket.push(issue);
    }
  }

  const definitions = groupDefinitions(groupBy, context);
  const known = new Set(definitions.map((definition) => definition.id));
  const extras = [...buckets.keys()]
    .filter((key) => !known.has(key))
    .map((key) => ({ id: key, title: 'Other', color: null, category: null }));

  return [...definitions, ...extras].flatMap((definition) => {
    const bucket = buckets.get(definition.id) ?? [];
    if (bucket.length === 0 && !options.showEmptyGroups) return [];
    return [{ ...definition, issues: options.ordering === 'manual' ? sortIssues(bucket) : bucket }];
  });
}

export function priorityLabel(priority: number): string {
  const known = PRIORITIES.find((entry) => entry === priority);
  return known === undefined ? 'No priority' : PRIORITY_LABELS[known];
}
