'use client';

import type { DocCommentAnchor } from '@orbit/shared/validators';
import type { Editor } from '@tiptap/core';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { prefersReducedMotion } from './doc-scroll.ts';
import {
  DOC_ANCHOR_ATTRIBUTE,
  type DocAnchorDecoration,
  docAnchorPlugin,
  docAnchorPluginKey,
} from './editor/anchor-plugin.ts';
import { anchorFromSelection, anchorRangeIn, docTextOf } from './editor/anchor-positions.ts';
import type { EditorSelectionRange } from './editor/rich-text-editor.tsx';

export interface DocAnchorTarget {
  readonly commentId: string;
  readonly anchor: DocCommentAnchor;
}

export interface DocCommenting {
  readonly targets: readonly DocAnchorTarget[];
  readonly focusedCommentId: string | null;
  readonly onSelectPassage: (commentId: string) => void;
  readonly onTextChange: (text: string) => void;
  readonly onAnchorSelected: (anchor: DocCommentAnchor) => void;
  readonly revealRef: RefObject<((commentId: string) => void) | null>;
}

export interface DocAnchors {
  readonly startComment: (range: EditorSelectionRange) => void;
}

const NO_TARGETS: readonly DocAnchorTarget[] = [];

function usable(editor: Editor | null): editor is Editor {
  return editor !== null && !editor.isDestroyed;
}

function decorationsFor(
  editor: Editor,
  targets: readonly DocAnchorTarget[],
  focusedCommentId: string | null,
): readonly DocAnchorDecoration[] {
  const docText = docTextOf(editor.state.doc);
  return targets.flatMap((target) => {
    const range = anchorRangeIn(docText, target.anchor);
    if (range === null) return [];
    return [
      {
        commentId: target.commentId,
        from: range.from,
        to: range.to,
        focused: focusedCommentId === target.commentId,
      },
    ];
  });
}

export function useDocAnchors(
  editor: Editor | null,
  commenting: DocCommenting | undefined,
): DocAnchors {
  const ranges = useRef<readonly DocAnchorDecoration[]>([]);

  const targets = commenting?.targets ?? NO_TARGETS;
  const focusedCommentId = commenting?.focusedCommentId ?? null;
  const onTextChange = commenting?.onTextChange;
  const onSelectPassage = commenting?.onSelectPassage;
  const onAnchorSelected = commenting?.onAnchorSelected;
  const revealRef = commenting?.revealRef;

  const recompute = useCallback(() => {
    if (!usable(editor)) return;
    onTextChange?.(docTextOf(editor.state.doc).text);
    ranges.current = decorationsFor(editor, targets, focusedCommentId);
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [editor, targets, focusedCommentId, onTextChange]);

  useEffect(() => {
    if (!usable(editor)) return;
    editor.registerPlugin(docAnchorPlugin(ranges));
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(docAnchorPluginKey);
    };
  }, [editor]);

  useEffect(() => {
    if (!usable(editor)) return;
    editor.on('update', recompute);
    return () => {
      editor.off('update', recompute);
    };
  }, [editor, recompute]);

  useEffect(() => recompute(), [recompute]);

  useEffect(() => {
    if (!usable(editor) || onSelectPassage === undefined) return;
    const surface = editor.view.dom;
    const onClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const marked = target.closest(`[${DOC_ANCHOR_ATTRIBUTE}]`);
      const commentId = marked?.getAttribute(DOC_ANCHOR_ATTRIBUTE);
      if (typeof commentId === 'string') onSelectPassage(commentId);
    };
    surface.addEventListener('click', onClick);
    return () => surface.removeEventListener('click', onClick);
  }, [editor, onSelectPassage]);

  const revealPassage = useCallback(
    (commentId: string) => {
      if (!usable(editor)) return;
      const range = ranges.current.find((entry) => entry.commentId === commentId);
      if (range === undefined) return;
      const found = editor.view.domAtPos(range.from).node;
      const element = found instanceof Element ? found : found.parentElement;
      element?.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    },
    [editor],
  );

  useEffect(() => {
    if (revealRef === undefined) return;
    revealRef.current = revealPassage;
    return () => {
      revealRef.current = null;
    };
  }, [revealRef, revealPassage]);

  const startComment = useCallback(
    (range: EditorSelectionRange) => {
      if (!usable(editor) || onAnchorSelected === undefined) return;
      const anchor = anchorFromSelection(docTextOf(editor.state.doc), range.from, range.to);
      if (anchor !== null) onAnchorSelected(anchor);
    },
    [editor, onAnchorSelected],
  );

  return { startComment };
}
