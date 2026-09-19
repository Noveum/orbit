'use client';

import type { IssueExpectedProperties } from '@orbit/shared/validators';
import { useCallback, useRef } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { useHotkey } from '@/lib/keyboard/use-hotkey.ts';
import type { Issue } from '@/lib/query/use-issues.ts';
import { useUpdateIssue } from '@/lib/query/use-issues.ts';

const MAX_HISTORY = 20;

export interface PropertyUndoEntry {
  readonly issue: Issue;
  readonly propertyLabel: string;
  readonly patch: Record<string, unknown>;
  readonly inversePatch: Record<string, unknown>;
  readonly expectedForUndo: IssueExpectedProperties;
  readonly expectedForRedo: IssueExpectedProperties;
}

const tabUndoStack: PropertyUndoEntry[] = [];
const tabRedoStack: PropertyUndoEntry[] = [];

export function recordTabPropertyChange(entry: PropertyUndoEntry): void {
  tabRedoStack.length = 0;
  tabUndoStack.push(entry);
  if (tabUndoStack.length > MAX_HISTORY) {
    tabUndoStack.shift();
  }
}

export function useIssuePropertyUndo() {
  const inFlightRef = useRef(false);
  const updateIssueMutation = useUpdateIssue();
  const { toast } = useToast();

  const undo = useCallback(async () => {
    if (inFlightRef.current) return;
    const entry = tabUndoStack.pop();
    if (entry === undefined) return;

    inFlightRef.current = true;
    try {
      await updateIssueMutation.mutateAsync({
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
  }, [updateIssueMutation, toast]);

  const redo = useCallback(async () => {
    if (inFlightRef.current) return;
    const entry = tabRedoStack.pop();
    if (entry === undefined) return;

    inFlightRef.current = true;
    try {
      await updateIssueMutation.mutateAsync({
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
  }, [updateIssueMutation, toast]);

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
    undo,
    redo,
  };
}
