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
import type { DocText } from './editor/anchor-positions.ts';
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

export const DOC_ANCHOR_SETTLE_MS = 120;

function usable(editor: Editor | null): editor is Editor {
  return editor !== null && !editor.isDestroyed;
}

function decorationsFor(
  docText: DocText,
  targets: readonly DocAnchorTarget[],
  focusedCommentId: string | null,
): readonly DocAnchorDecoration[] {
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
    if (targets.length === 0) {
      if (ranges.current.length === 0) return;
      ranges.current = [];
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
      return;
    }
    const docText = docTextOf(editor.state.doc);
    onTextChange?.(docText.text);
    ranges.current = decorationsFor(docText, targets, focusedCommentId);
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [editor, targets, focusedCommentId, onTextChange]);

  const latest = useRef(recompute);
  latest.current = recompute;

  useEffect(() => {
    if (!usable(editor)) return;
    editor.registerPlugin(docAnchorPlugin(ranges));
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(docAnchorPluginKey);
    };
  }, [editor]);

  useEffect(() => {
    if (!usable(editor)) return;
    let queued: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (queued !== null) clearTimeout(queued);
      queued = setTimeout(() => {
        queued = null;
        latest.current();
      }, DOC_ANCHOR_SETTLE_MS);
    };
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
      if (queued !== null) clearTimeout(queued);
    };
  }, [editor]);

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
