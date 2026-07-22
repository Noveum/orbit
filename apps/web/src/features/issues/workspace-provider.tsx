'use client';

import { STATE_CATEGORY_ORDER, type StateCategory } from '@orbit/shared/constants';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type {
  Bootstrap,
  Cycle,
  Label,
  Member,
  Project,
  Team,
  WorkflowState,
} from '@/lib/query/schemas.ts';
import { useBootstrap } from '@/lib/query/use-issues.ts';
import { QuickCreateDialog } from './quick-create.tsx';

export interface WorkspaceData {
  readonly ready: boolean;
  readonly userId: string | null;
  readonly teams: readonly Team[];
  readonly states: readonly WorkflowState[];
  readonly labels: readonly Label[];
  readonly members: readonly Member[];
  readonly projects: readonly Project[];
  readonly cycles: readonly Cycle[];
  readonly seedIssues: Bootstrap['issues'];
  readonly stateById: ReadonlyMap<string, WorkflowState>;
  readonly labelById: ReadonlyMap<string, Label>;
  readonly memberById: ReadonlyMap<string, Member>;
  readonly openQuickCreate: (teamId?: string) => void;
}

const EMPTY_MAP = new Map<string, never>();

const WorkspaceContext = createContext<WorkspaceData>({
  ready: false,
  userId: null,
  teams: [],
  states: [],
  labels: [],
  members: [],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: EMPTY_MAP,
  labelById: EMPTY_MAP,
  memberById: EMPTY_MAP,
  openQuickCreate: () => undefined,
});

export function useWorkspace(): WorkspaceData {
  return useContext(WorkspaceContext);
}

export function orderStates(states: readonly WorkflowState[]): WorkflowState[] {
  return [...states].sort((left, right) => {
    const leftOrder = STATE_CATEGORY_ORDER[left.category as StateCategory] ?? 99;
    const rightOrder = STATE_CATEGORY_ORDER[right.category as StateCategory] ?? 99;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.position - right.position;
  });
}

export function statesForTeam(
  states: readonly WorkflowState[],
  teamId: string | null,
): WorkflowState[] {
  if (teamId === null) return [];
  return orderStates(states.filter((state) => state.teamId === teamId));
}

export function IssueWorkspaceProvider({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrap(null);
  const [createTeamId, setCreateTeamId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const data = bootstrap.data;

  const value = useMemo<WorkspaceData>(() => {
    const states = data?.states ?? [];
    const labels = data?.labels ?? [];
    const members = data?.members ?? [];
    return {
      ready: data !== undefined,
      userId: data?.userId ?? null,
      teams: data?.teams ?? [],
      states,
      labels,
      members,
      projects: data?.projects ?? [],
      cycles: data?.cycles ?? [],
      seedIssues: data?.issues ?? [],
      stateById: new Map(states.map((state) => [state.id, state])),
      labelById: new Map(labels.map((label) => [label.id, label])),
      memberById: new Map(members.map((member) => [member.id, member])),
      openQuickCreate: (teamId?: string) => {
        setCreateTeamId(teamId ?? null);
        setCreateOpen(true);
      },
    };
  }, [data]);

  useHotkey(
    'c',
    () => {
      setCreateOpen(true);
    },
    { label: 'Create issue', section: 'Issues' },
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <QuickCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultTeamId={createTeamId}
      />
    </WorkspaceContext.Provider>
  );
}
