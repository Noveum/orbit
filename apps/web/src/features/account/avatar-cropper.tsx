'use client';

import { AVATAR_CONTENT_TYPE, AVATAR_DIMENSION } from '@orbit/shared/constants';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { clampOffset, displayGeometry, type Point, type Size, sourceCrop } from './crop.ts';

const VIEWPORT = 288;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.01;
const OUTPUT_QUALITY = 0.92;

export interface AvatarCropperProps {
  readonly file: File;
  readonly pending?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (blob: Blob) => void;
}

interface DragState {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly offset: Point;
}

export function AvatarCropper({ file, pending = false, onCancel, onConfirm }: AvatarCropperProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [rendering, setRendering] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setNatural(null);
    setFailed(false);
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onImageLoad(event: React.SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;
    setNatural({ width: image.naturalWidth, height: image.naturalHeight });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (natural === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, offset };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (drag === null || natural === null) return;
    const next = {
      x: drag.offset.x + (event.clientX - drag.pointerX),
      y: drag.offset.y + (event.clientY - drag.pointerY),
    };
    setOffset(clampOffset(next, natural, VIEWPORT, zoom));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onZoomChange(value: number): void {
    if (natural === null) return;
    setOffset((current) => clampOffset(current, natural, VIEWPORT, value));
    setZoom(value);
  }

  function confirm(): void {
    const image = imageRef.current;
    if (image === null || natural === null) return;
    const crop = sourceCrop(natural, VIEWPORT, zoom, offset);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_DIMENSION;
    canvas.height = AVATAR_DIMENSION;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, AVATAR_DIMENSION, AVATAR_DIMENSION);
    context.drawImage(
      image,
      crop.sx,
      crop.sy,
      crop.size,
      crop.size,
      0,
      0,
      AVATAR_DIMENSION,
      AVATAR_DIMENSION,
    );
    setRendering(true);
    canvas.toBlob(
      (blob) => {
        setRendering(false);
        if (blob !== null) onConfirm(blob);
      },
      AVATAR_CONTENT_TYPE,
      OUTPUT_QUALITY,
    );
  }

  const geometry = natural === null ? null : displayGeometry(natural, VIEWPORT, zoom, offset);
  const busy = pending || rendering;

  return (
    <div className="flex flex-col items-center gap-4">
      {failed ? (
        <p role="alert" className="py-10 text-center text-danger text-dense">
          That image could not be opened. Pick a different photo.
        </p>
      ) : (
        <>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative touch-none overflow-hidden rounded-full border border-border bg-surface-2 [&_img]:pointer-events-none"
            style={{
              width: VIEWPORT,
              height: VIEWPORT,
              cursor: natural === null ? 'default' : 'grab',
            }}
          >
            {objectUrl === null ? null : (
              // biome-ignore lint/performance/noImgElement: the cropper draws from a raw element onto a canvas
              <img
                ref={imageRef}
                src={objectUrl}
                alt=""
                draggable={false}
                onLoad={onImageLoad}
                onError={() => setFailed(true)}
                className="absolute max-w-none select-none"
                style={
                  geometry === null
                    ? { visibility: 'hidden' }
                    : {
                        width: geometry.width,
                        height: geometry.height,
                        left: geometry.left,
                        top: geometry.top,
                      }
                }
              />
            )}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/25 ring-inset"
            />
          </div>

          <div className="flex w-full max-w-[288px] items-center gap-2">
            <ZoomOut className="size-4 shrink-0 text-faint" aria-hidden />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              disabled={natural === null || busy}
              aria-label="Zoom"
              onChange={(event) => onZoomChange(Number(event.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
            />
            <ZoomIn className="size-4 shrink-0 text-faint" aria-hidden />
          </div>
        </>
      )}

      <div className="flex w-full justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={confirm}
          disabled={busy || natural === null || failed}
        >
          {busy ? 'Saving' : 'Set photo'}
        </Button>
      </div>
    </div>
  );
}
