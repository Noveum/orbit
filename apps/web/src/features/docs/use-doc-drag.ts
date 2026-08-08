'use client';

import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocSummary } from '@/lib/query/schemas.ts';
import type { DocDropTarget, DocMove } from './doc-drop.ts';
import { edgeFor, planDocDrop } from './doc-drop.ts';
import { DOC_DRAG_PREFIX, type DropHint, GROUP_DRAG_PREFIX } from './doc-tree-rows.tsx';

export function targetOf(overId: string, offsetY: number, height: number): DocDropTarget | null {
  if (overId.startsWith(GROUP_DRAG_PREFIX)) {
    return { kind: 'group', id: overId.slice(GROUP_DRAG_PREFIX.length), edge: 'inside' };
  }
  if (!overId.startsWith(DOC_DRAG_PREFIX)) return null;
  return {
    kind: 'doc',
    id: overId.slice(DOC_DRAG_PREFIX.length),
    edge: edgeFor(offsetY, height, true),
  };
}

export interface DocDragControl {
  readonly activeId: string | null;
  readonly hint: DropHint | null;
  readonly onDragStart: (event: DragStartEvent) => void;
  readonly onDragMove: (event: DragMoveEvent) => void;
  readonly onDragEnd: (event: DragEndEvent) => void;
  readonly onDragCancel: () => void;
}

export function useDocDrag(
  docs: readonly DocSummary[],
  onMove: (move: DocMove) => void,
): DocDragControl {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const pointerY = useRef(0);

  useEffect(() => {
    if (activeId === null) return;
    const track = (event: PointerEvent) => {
      pointerY.current = event.clientY;
    };
    window.addEventListener('pointermove', track);
    document.body.classList.add('cursor-grabbing');
    return () => {
      window.removeEventListener('pointermove', track);
      document.body.classList.remove('cursor-grabbing');
    };
  }, [activeId]);

  const resolve = useCallback((event: DragMoveEvent | DragEndEvent): DocDropTarget | null => {
    if (event.over === null) return null;
    const rect = event.over.rect;
    return targetOf(String(event.over.id), pointerY.current - rect.top, rect.height);
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id.startsWith(DOC_DRAG_PREFIX) ? id.slice(DOC_DRAG_PREFIX.length) : null);
  }, []);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const target = resolve(event);
      setHint(target === null ? null : { targetId: target.id, edge: target.edge });
    },
    [resolve],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const target = resolve(event);
      const dragged = String(event.active.id);
      setActiveId(null);
      setHint(null);
      if (target === null || !dragged.startsWith(DOC_DRAG_PREFIX)) return;
      const move = planDocDrop(docs, dragged.slice(DOC_DRAG_PREFIX.length), target);
      if (move !== null) onMove(move);
    },
    [docs, onMove, resolve],
  );

  const onDragCancel = useCallback(() => {
    setActiveId(null);
    setHint(null);
  }, []);

  return { activeId, hint, onDragStart, onDragMove, onDragEnd, onDragCancel };
}
