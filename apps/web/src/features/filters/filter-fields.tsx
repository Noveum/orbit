import { PRIORITY_LABELS } from '@orbit/shared/constants';
import type { FilterField, FilterPredicate } from '@orbit/shared/filters';
import {
  DUE_FILTER_LABELS,
  DUE_FILTER_VALUES,
  FILTER_FIELD_LABELS,
  UNSET_FILTER_VALUE,
} from '@orbit/shared/filters';
import type { LucideIcon } from 'lucide-react';
import {
  CalendarClock,
  CircleDashed,
  FolderKanban,
  RefreshCcw,
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
import { PRIORITY_ORDER } from './grouping.ts';

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly icon: ReactNode;
}

export interface FilterFieldDefinition {
  readonly field: FilterField;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly options: readonly FilterOption[];
}

const FIELD_ICONS: Record<FilterField, LucideIcon> = {
  state: CircleDashed,
  assignee: Users,
  label: Tag,
  priority: SignalHigh,
  project: FolderKanban,
  cycle: RefreshCcw,
  creator: UserPlus,
  due: CalendarClock,
};

function colorDot(color: string): ReactNode {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

function unsetOption(label: string): FilterOption {
  return {
    value: UNSET_FILTER_VALUE,
    label,
    icon: <span className="size-3 shrink-0 rounded-full border border-border border-dashed" />,
  };
}

export function buildFilterFields(
  workspace: WorkspaceData,
  teamId: string | null,
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

  const groups: { field: FilterField; options: readonly FilterOption[] }[] = [
    {
      field: 'state',
      options: states.map((state) => ({
        value: state.id,
        label: state.name,
        icon: <StateGlyph category={state.category} color={state.color} />,
      })),
    },
    { field: 'assignee', options: [...people, unsetOption('No assignee')] },
    {
      field: 'label',
      options: [
        ...labels.map((label) => ({
          value: label.id,
          label: label.name,
          icon: colorDot(label.color),
        })),
        unsetOption('No label'),
      ],
    },
    {
      field: 'priority',
      options: PRIORITY_ORDER.map((priority) => ({
        value: String(priority),
        label: PRIORITY_LABELS[priority],
        icon: <PriorityGlyph priority={priority} />,
      })),
    },
    {
      field: 'project',
      options: [
        ...workspace.projects.map((project) => ({
          value: project.id,
          label: project.name,
          icon: colorDot(project.color),
        })),
        unsetOption('No project'),
      ],
    },
    {
      field: 'cycle',
      options: [
        ...cycles.map((cycle) => ({
          value: cycle.id,
          label: cycle.name,
          icon: <RefreshCcw className="size-3 shrink-0 text-faint" aria-hidden="true" />,
        })),
        unsetOption('No cycle'),
      ],
    },
    { field: 'creator', options: people },
    {
      field: 'due',
      options: DUE_FILTER_VALUES.map((value) => ({
        value,
        label: DUE_FILTER_LABELS[value],
        icon: <CalendarClock className="size-3 shrink-0 text-faint" aria-hidden="true" />,
      })),
    },
  ];

  return groups
    .map((entry) => ({
      ...entry,
      label: FILTER_FIELD_LABELS[entry.field],
      icon: FIELD_ICONS[entry.field],
    }))
    .filter((definition) => definition.options.length > 0);
}

export function operatorLabel(predicate: FilterPredicate): string {
  const many = predicate.values.length > 1;
  if (predicate.operator === 'is_not') return many ? 'is not any of' : 'is not';
  return many ? 'is any of' : 'is';
}

export function valueLabel(
  predicate: FilterPredicate,
  definition: FilterFieldDefinition | undefined,
): string {
  const names = predicate.values.map(
    (value) => definition?.options.find((option) => option.value === value)?.label ?? value,
  );
  const [first, ...rest] = names;
  if (first === undefined) return 'anything';
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

export function describePredicate(
  predicate: FilterPredicate,
  definitions: readonly FilterFieldDefinition[],
): string {
  const definition = definitions.find((entry) => entry.field === predicate.field);
  const fieldLabel = definition?.label ?? FILTER_FIELD_LABELS[predicate.field];
  return `${fieldLabel} ${operatorLabel(predicate)} ${valueLabel(predicate, definition)}`;
}
