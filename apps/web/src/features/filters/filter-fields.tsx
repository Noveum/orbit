import { PRIORITY_LABELS } from '@orbit/shared/constants';
import type { FilterCondition, FilterProperty } from '@orbit/shared/filters';
import {
  describeRelative,
  FILTER_PROPERTY_LABELS,
  LINK_FILTER_LABELS,
  LINK_FILTER_VALUES,
  RELATION_FILTER_LABELS,
  RELATION_FILTER_VALUES,
  UNSET_FILTER_VALUE,
} from '@orbit/shared/filters';
import type { LucideIcon } from 'lucide-react';
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  CircleDashed,
  Flag,
  Gauge,
  History,
  Link2,
  Network,
  Paperclip,
  PlayCircle,
  RefreshCcw,
  Search,
  SignalHigh,
  Tag,
  UserPlus,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { PriorityGlyph } from '@/features/issues/priority-glyph.tsx';
import { StateGlyph } from '@/features/issues/state-glyph.tsx';
import { statesForTeam, type WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { PRIORITY_ORDER } from './grouping.ts';

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly icon: ReactNode;
}

export type FilterInputKind = 'values' | 'text' | 'dates';

export interface FilterFieldDefinition {
  readonly property: FilterProperty;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly input: FilterInputKind;
  readonly options: readonly FilterOption[];
  readonly countOf: ((issue: Issue) => readonly string[]) | null;
}

const FIELD_ICONS: Record<FilterProperty, LucideIcon> = {
  state: CircleDashed,
  assignee: Users,
  creator: UserPlus,
  subscriber: Users,
  priority: SignalHigh,
  estimate: Gauge,
  label: Tag,
  project: Flag,
  cycle: RefreshCcw,
  milestone: Flag,
  relation: Network,
  link: Paperclip,
  content: Search,
  due: CalendarClock,
  created: CalendarPlus,
  updated: CalendarRange,
  started: PlayCircle,
  completed: CalendarCheck,
  stateAge: History,
};

export const DATE_OPTION_VALUES = ['none', 'any', 'overdue', 'today', 'this_week'] as const;

const DATE_OPTION_LABELS: Record<(typeof DATE_OPTION_VALUES)[number], string> = {
  none: 'Not set',
  any: 'Set',
  overdue: 'Before today',
  today: 'Today',
  this_week: 'Within a week',
};

export const RELATIVE_PRESETS = [
  { key: 'past-1-week', label: 'In the past week', unit: 'week', offset: 1, direction: 'past' },
  { key: 'past-1-month', label: 'In the past month', unit: 'month', offset: 1, direction: 'past' },
  { key: 'next-1-week', label: 'In the next week', unit: 'week', offset: 1, direction: 'future' },
  {
    key: 'next-2-week',
    label: 'In the next 2 weeks',
    unit: 'week',
    offset: 2,
    direction: 'future',
  },
  {
    key: 'next-1-month',
    label: 'In the next month',
    unit: 'month',
    offset: 1,
    direction: 'future',
  },
] as const;

function colorDot(color: string): ReactNode {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

function glyph(Icon: LucideIcon): ReactNode {
  return <Icon className="size-3 shrink-0 text-faint" aria-hidden="true" />;
}

function unsetOption(label: string): FilterOption {
  return {
    value: UNSET_FILTER_VALUE,
    label,
    icon: <span className="size-3 shrink-0 rounded-full border border-border border-dashed" />,
  };
}

function dateOptions(): FilterOption[] {
  return DATE_OPTION_VALUES.map((value) => ({
    value,
    label: DATE_OPTION_LABELS[value],
    icon: glyph(CalendarClock),
  }));
}

function idsOf(value: string | null): readonly string[] {
  return [value ?? UNSET_FILTER_VALUE];
}

export function buildFilterFields(
  workspace: WorkspaceData,
  teamId: string | null,
  allowed: readonly FilterProperty[],
): FilterFieldDefinition[] {
  const states = statesForTeam(workspace.states, teamId);
  const people: FilterOption[] = workspace.members.map((member) => ({
    value: member.id,
    label: member.name,
    icon: <Avatar name={member.name} src={member.image} size="xs" />,
  }));
  const labels = workspace.labels.filter(
    (label) => label.teamId === null || teamId === null || label.teamId === teamId,
  );
  const cycles = workspace.cycles.filter((cycle) => teamId === null || cycle.teamId === teamId);
  const estimates = [0, 1, 2, 3, 5, 8, 13];

  const definitions: Omit<FilterFieldDefinition, 'label' | 'icon'>[] = [
    {
      property: 'state',
      input: 'values',
      options: states.map((state) => ({
        value: state.id,
        label: state.name,
        icon: <StateGlyph category={state.category} color={state.color} />,
      })),
      countOf: (issue) => [issue.stateId],
    },
    {
      property: 'assignee',
      input: 'values',
      options: [...people, unsetOption('No assignee')],
      countOf: (issue) => idsOf(issue.assigneeId),
    },
    {
      property: 'creator',
      input: 'values',
      options: people,
      countOf: (issue) => [issue.creatorId],
    },
    {
      property: 'subscriber',
      input: 'values',
      options: [...people, unsetOption('No subscribers')],
      countOf: null,
    },
    {
      property: 'priority',
      input: 'values',
      options: PRIORITY_ORDER.map((priority) => ({
        value: String(priority),
        label: PRIORITY_LABELS[priority],
        icon: <PriorityGlyph priority={priority} />,
      })),
      countOf: (issue) => [String(issue.priority)],
    },
    {
      property: 'estimate',
      input: 'values',
      options: [
        unsetOption('No estimate'),
        ...estimates.map((points) => ({
          value: String(points),
          label: points === 1 ? '1 Point' : `${points} Points`,
          icon: glyph(Gauge),
        })),
      ],
      countOf: (issue) => [issue.estimate === null ? UNSET_FILTER_VALUE : String(issue.estimate)],
    },
    {
      property: 'label',
      input: 'values',
      options: [
        ...labels.map((label) => ({
          value: label.id,
          label: label.name,
          icon: colorDot(label.color),
        })),
        unsetOption('No label'),
      ],
      countOf: (issue) => {
        const ids = Array.isArray(issue.labelIds) ? issue.labelIds : [];
        return ids.length === 0 ? [UNSET_FILTER_VALUE] : ids;
      },
    },
    {
      property: 'project',
      input: 'values',
      options: [
        ...workspace.projects.map((project) => ({
          value: project.id,
          label: project.name,
          icon: colorDot(project.color),
        })),
        unsetOption('No project'),
      ],
      countOf: (issue) => idsOf(issue.projectId),
    },
    {
      property: 'cycle',
      input: 'values',
      options: [
        ...cycles.map((cycle) => ({
          value: cycle.id,
          label: cycle.name.length === 0 ? `Cycle ${cycle.number}` : cycle.name,
          icon: glyph(RefreshCcw),
        })),
        unsetOption('No cycle'),
      ],
      countOf: (issue) => idsOf(issue.cycleId),
    },
    {
      property: 'milestone',
      input: 'values',
      options: [
        { value: 'any', label: 'Has a milestone', icon: glyph(Flag) },
        unsetOption('No milestone'),
      ],
      countOf: (issue) => [issue.milestoneId === null ? UNSET_FILTER_VALUE : 'any'],
    },
    {
      property: 'relation',
      input: 'values',
      options: RELATION_FILTER_VALUES.map((value) => ({
        value,
        label: RELATION_FILTER_LABELS[value],
        icon: glyph(Network),
      })),
      countOf: null,
    },
    {
      property: 'link',
      input: 'values',
      options: LINK_FILTER_VALUES.map((value) => ({
        value,
        label: LINK_FILTER_LABELS[value],
        icon: glyph(Link2),
      })),
      countOf: null,
    },
    { property: 'content', input: 'text', options: [], countOf: null },
    { property: 'due', input: 'dates', options: dateOptions(), countOf: null },
    { property: 'created', input: 'dates', options: dateOptions(), countOf: null },
    { property: 'updated', input: 'dates', options: dateOptions(), countOf: null },
    { property: 'started', input: 'dates', options: dateOptions(), countOf: null },
    { property: 'completed', input: 'dates', options: dateOptions(), countOf: null },
    { property: 'stateAge', input: 'dates', options: dateOptions(), countOf: null },
  ];

  return definitions
    .filter((definition) => allowed.includes(definition.property))
    .map((definition) => ({
      ...definition,
      label: FILTER_PROPERTY_LABELS[definition.property],
      icon: FIELD_ICONS[definition.property],
    }))
    .filter((definition) => definition.input !== 'values' || definition.options.length > 0);
}

export function countValues(
  definition: FilterFieldDefinition,
  issues: readonly Issue[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const read = definition.countOf;
  if (read === null) return counts;
  const list: readonly Issue[] = Array.isArray(issues) ? issues : [];
  for (const issue of list) {
    const keys = read(issue);
    if (!Array.isArray(keys)) continue;
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function operatorLabel(condition: FilterCondition): string {
  if (condition.operator === 'exact') return condition.negate ? 'does not contain' : 'contains';
  if (condition.operator === 'relative') return condition.negate ? 'is not' : 'is';
  if (condition.operator === 'range') return condition.negate ? 'is not between' : 'is between';
  const many = condition.values.length > 1;
  if (condition.negate) return many ? 'is not any of' : 'is not';
  return many ? 'is any of' : 'is';
}

export function valueLabel(
  condition: FilterCondition,
  definition: FilterFieldDefinition | undefined,
): string {
  if (condition.operator === 'exact') return condition.value;
  if (condition.operator === 'relative') return describeRelative(condition.relative);
  if (condition.operator === 'range') {
    return `${condition.from ?? 'any'} and ${condition.to ?? 'any'}`;
  }
  const names = condition.values.map(
    (value) => definition?.options.find((option) => option.value === value)?.label ?? value,
  );
  const [first, ...rest] = names;
  if (first === undefined) return 'anything';
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

export function describeCondition(
  condition: FilterCondition,
  definitions: readonly FilterFieldDefinition[],
): string {
  const definition = definitions.find((entry) => entry.property === condition.property);
  const fieldLabel = definition?.label ?? FILTER_PROPERTY_LABELS[condition.property];
  return `${fieldLabel} ${operatorLabel(condition)} ${valueLabel(condition, definition)}`;
}
