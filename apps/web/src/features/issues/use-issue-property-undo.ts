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

export function useIssuePropertyUndo() {
  const undoStackRef = useRef<PropertyUndoEntry[]>([]);
  const redoStackRef = useRef<PropertyUndoEntry[]>([]);
  const inFlightRef = useRef(false);
  const updateIssueMutation = useUpdateIssue();
  const { toast } = useToast();

  const recordPropertyChange = useCallback((entry: PropertyUndoEntry) => {
    redoStackRef.current = [];
    const nextStack = [...undoStackRef.current, entry];
    if (nextStack.length > MAX_HISTORY) {
      nextStack.shift();
    }
    undoStackRef.current = nextStack;
  }, []);

  const undo = useCallback(async () => {
    if (inFlightRef.current) return;
    const entry = undoStackRef.current.pop();
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

      redoStackRef.current.push(entry);
      toast({
        title: `Reverted ${entry.propertyLabel}`,
        tone: 'neutral',
      });
    } catch {
      toast({
        title: `Could not undo ${entry.propertyLabel}`,
        description: 'The issue was modified elsewhere.',
        tone: 'danger',
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [updateIssueMutation, toast]);

  const redo = useCallback(async () => {
    if (inFlightRef.current) return;
    const entry = redoStackRef.current.pop();
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

      undoStackRef.current.push(entry);
      toast({
        title: `Restored ${entry.propertyLabel}`,
        tone: 'neutral',
      });
    } catch {
      toast({
        title: `Could not redo ${entry.propertyLabel}`,
        description: 'The issue was modified elsewhere.',
        tone: 'danger',
      });
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
    recordPropertyChange,
    undo,
    redo,
  };
}
