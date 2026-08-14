'use client';

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { cn } from '@/lib/cn.ts';
import { inkLabels, naturalWidth } from './mermaid.ts';

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 6;
export const SCALE_STEP = 1.25;
export const PAN_STEP = 80;
export const VIEWER_PADDING = 96;

export interface Placement {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const RESET: Placement = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function scaleToFit(natural: number, available: number): number {
  if (natural <= 0 || available <= 0) return 1;
  return clampScale(Math.min(1, available / natural));
}

export interface DiagramViewerProps {
  readonly svg: string | null;
  readonly label: string;
  readonly onClose: () => void;
}

export function DiagramViewer({ svg, label, onClose }: DiagramViewerProps) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const touched = useRef(false);
  const [placement, setPlacement] = useState<Placement>(RESET);

  const fitView = useCallback(() => {
    const node = viewport.current;
    const drawn = node?.querySelector('svg') ?? null;
    if (node === null || drawn === null) return;
    touched.current = false;
    setPlacement({
      ...RESET,
      scale: scaleToFit(naturalWidth(drawn), node.clientWidth - VIEWER_PADDING),
    });
  }, []);

  useEffect(() => {
    if (svg === null) return;
    const frame = requestAnimationFrame(() => {
      const node = viewport.current;
      if (node === null) return;
      inkLabels(node);
      fitView();
    });
    return () => cancelAnimationFrame(frame);
  }, [svg, fitView]);

  useEffect(() => {
    const node = viewport.current;
    if (svg === null || node === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!touched.current) fitView();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [svg, fitView]);

  const zoom = useCallback((factor: number) => {
    touched.current = true;
    setPlacement((current) => ({ ...current, scale: clampScale(current.scale * factor) }));
  }, []);

  const pan = useCallback((dx: number, dy: number) => {
    touched.current = true;
    setPlacement((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => void> = {
      ArrowUp: () => pan(0, PAN_STEP),
      ArrowDown: () => pan(0, -PAN_STEP),
      ArrowLeft: () => pan(PAN_STEP, 0),
      ArrowRight: () => pan(-PAN_STEP, 0),
      '+': () => zoom(SCALE_STEP),
      '=': () => zoom(SCALE_STEP),
      '-': () => zoom(1 / SCALE_STEP),
      '0': fitView,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    move();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button') !== null) return;
    dragging.current = { x: event.clientX - placement.x, y: event.clientY - placement.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragging.current;
    if (from === null) return;
    touched.current = true;
    setPlacement((current) => ({
      ...current,
      x: event.clientX - from.x,
      y: event.clientY - from.y,
    }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Dialog
      open={svg !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="diagram-viewer"
        onKeyDown={onKeyDown}
        className="flex h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] max-w-none flex-col overflow-hidden p-0"
      >
        <DialogTitle className="border-border border-b px-4 py-2.5 font-medium text-dense text-text">
          {label}
        </DialogTitle>

        <div
          ref={viewport}
          data-testid="diagram-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(event) => zoom(event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP)}
          className={cn(
            'relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-surface-2',
            'active:cursor-grabbing',
          )}
        >
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              '[&_svg]:h-auto [&_svg]:max-w-none',
            )}
            style={{
              transform: `translate(${placement.x}px, ${placement.y}px) scale(${placement.scale})`,
            }}
          >
            {svg === null ? null : (
              <div
                role="img"
                aria-label={label}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: the drawn svg is sanitised in renderDiagram
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            )}
          </div>

          <div className="absolute right-4 bottom-4 grid grid-cols-3 gap-1">
            <span />
            <ViewerButton label="Pan up" icon={ChevronUp} onPress={() => pan(0, PAN_STEP)} />
            <ViewerButton label="Zoom in" icon={ZoomIn} onPress={() => zoom(SCALE_STEP)} />
            <ViewerButton label="Pan left" icon={ChevronLeft} onPress={() => pan(PAN_STEP, 0)} />
            <ViewerButton
              label="Fit the diagram to the viewer"
              icon={RotateCcw}
              onPress={fitView}
            />
            <ViewerButton label="Pan right" icon={ChevronRight} onPress={() => pan(-PAN_STEP, 0)} />
            <span />
            <ViewerButton label="Pan down" icon={ChevronDown} onPress={() => pan(0, -PAN_STEP)} />
            <ViewerButton label="Zoom out" icon={ZoomOut} onPress={() => zoom(1 / SCALE_STEP)} />
          </div>

          <p
            data-testid="diagram-zoom"
            className="absolute bottom-4 left-4 m-0 rounded-sm border border-border bg-surface px-2 py-1 text-2xs text-muted tabular-nums"
          >
            {Math.round(placement.scale * 100)}%
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewerButton({
  label,
  icon: Icon,
  onPress,
}: {
  readonly label: string;
  readonly icon: typeof ZoomIn;
  readonly onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={cn(
        'flex size-8 items-center justify-center rounded-md border border-border bg-surface text-muted',
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
        'hover:bg-surface-3 hover:text-text motion-reduce:transition-none',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
