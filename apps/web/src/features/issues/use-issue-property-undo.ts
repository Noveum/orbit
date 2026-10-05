'use client';

import type { IssueExpectedProperties, IssueMoveExpected } from '@orbit/shared/validators';
import { useCallback, useRef } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { useHotkey } from '@/lib/keyboard/use-hotkey.ts';
import type { Issue, MoveInput } from '@/lib/query/use-issues.ts';
import { useMoveIssue, useUpdateIssue } from '@/lib/query/use-issues.ts';

const MAX_HISTORY = 20;

export interface PropertyUndoEntry {
  readonly sequence: number;
  readonly issue: Issue;
  readonly propertyLabel: string;
  readonly patch: Record<string, unknown>;
  readonly inversePatch: Record<string, unknown>;
  readonly expectedForUndo: IssueExpectedProperties;
  readonly expectedForRedo: IssueExpectedProperties;
}

export interface MoveUndoEntry {
  readonly sequence: number;
  readonly issue: Issue;
  readonly propertyLabel: 'Move';
  readonly forward: MoveInput;
  readonly inverse: MoveInput;
  readonly expectedForUndo: IssueMoveExpected;
  readonly expectedForRedo: IssueMoveExpected;
}

export type IssueUndoEntry = PropertyUndoEntry | MoveUndoEntry;

const tabUndoStack: IssueUndoEntry[] = [];
const tabRedoStack: IssueUndoEntry[] = [];

let actionSequenceCounter = 0;

export function nextActionSequence(): number {
  actionSequenceCounter += 1;
  return actionSequenceCounter;
}

function insertHistoryEntry(entry: IssueUndoEntry): void {
  const insertIndex = tabUndoStack.findIndex((item) => item.sequence > entry.sequence);

  if (insertIndex === -1) {
    tabUndoStack.push(entry);
  } else {
    tabUndoStack.splice(insertIndex, 0, entry);
  }

  if (tabUndoStack.length > MAX_HISTORY) {
    tabUndoStack.shift();
  }
}

export function recordTabPropertyChange(entry: PropertyUndoEntry): void {
  tabRedoStack.length = 0;
  insertHistoryEntry(entry);
}

export function recordTabMove(entry: MoveUndoEntry): void {
  tabRedoStack.length = 0;
  insertHistoryEntry(entry);
}

export function getTabUndoStack(): readonly PropertyUndoEntry[] {
  return tabUndoStack.filter((entry): entry is PropertyUndoEntry => !isMoveEntry(entry));
}

export function getTabRedoStack(): readonly PropertyUndoEntry[] {
  return tabRedoStack.filter((entry): entry is PropertyUndoEntry => !isMoveEntry(entry));
}

export function clearTabHistory(): void {
  tabUndoStack.length = 0;
  tabRedoStack.length = 0;
  actionSequenceCounter = 0;
}

export function pushTestRedoEntry(entry: PropertyUndoEntry): void {
  tabRedoStack.push(entry);
}

function isMoveEntry(entry: IssueUndoEntry): entry is MoveUndoEntry {
  return entry.propertyLabel === 'Move';
}

export function useIssuePropertyUndo() {
  const inFlightRef = useRef(false);

  const { mutateAsync: updateIssue } = useUpdateIssue();
  const { mutateAsync: moveIssue } = useMoveIssue();
  const { toast } = useToast();

  const undo = useCallback(async () => {
    if (inFlightRef.current) return;

    const entry = tabUndoStack.pop();

    if (entry === undefined) return;

    inFlightRef.current = true;

    try {
      if (isMoveEntry(entry)) {
        const settlement = await moveIssue({
          ...entry.inverse,
          expected: entry.expectedForUndo,
        });

        const settled = settlement.issues.find((issue) => issue.id === entry.issue.id);

        if (settled === undefined) {
          return;
        }

        tabRedoStack.push({
          ...entry,
          issue: settled,
          forward: {
            ...entry.forward,
            issue: settled,
          },
          inverse: {
            ...entry.inverse,
            issue: settled,
          },
          expectedForRedo: {
            stateId: settled.stateId,
            sortOrder: settled.sortOrder,
          },
        });

        toast({
          title: 'Reverted Move',
          tone: 'neutral',
        });

        return;
      }

      await updateIssue({
        issue: entry.issue,
        patch: {
          ...entry.inversePatch,
          expected: entry.expectedForUndo,
        },
      });

      tabRedoStack.push(entry);

      toast({
        title: `Reverted ${entry.propertyLabel}`,
        tone: 'neutral',
      });
    } catch {
      return;
    } finally {
      inFlightRef.current = false;
    }
  }, [moveIssue, toast, updateIssue]);

  const redo = useCallback(async () => {
    if (inFlightRef.current) return;

    const entry = tabRedoStack.pop();

    if (entry === undefined) return;

    inFlightRef.current = true;

    try {
      if (isMoveEntry(entry)) {
        const settlement = await moveIssue({
          ...entry.forward,
          expected: entry.expectedForRedo,
        });

        const settled = settlement.issues.find((issue) => issue.id === entry.issue.id);

        if (settled === undefined) {
          return;
        }

        tabUndoStack.push({
          ...entry,
          issue: settled,
          forward: {
            ...entry.forward,
            issue: settled,
          },
          inverse: {
            ...entry.inverse,
            issue: settled,
          },
          expectedForUndo: {
            stateId: settled.stateId,
            sortOrder: settled.sortOrder,
          },
        });

        toast({
          title: 'Restored Move',
          tone: 'neutral',
        });

        return;
      }

      await updateIssue({
        issue: entry.issue,
        patch: {
          ...entry.patch,
          expected: entry.expectedForRedo,
        },
      });

      tabUndoStack.push(entry);

      toast({
        title: `Restored ${entry.propertyLabel}`,
        tone: 'neutral',
      });
    } catch {
      return;
    } finally {
      inFlightRef.current = false;
    }
  }, [moveIssue, toast, updateIssue]);

  useHotkey('mod+z', undo, {
    label: 'Undo property change',
    section: 'Issues',
    allowInInput: false,
  });

  useHotkey('mod+shift+z', redo, {
    label: 'Redo property change',
    section: 'Issues',
    allowInInput: false,
    aliases: ['mod+y'],
  });

  return {
    recordPropertyChange: recordTabPropertyChange,
    recordMoveChange: recordTabMove,
    undo,
    redo,
  };
}
