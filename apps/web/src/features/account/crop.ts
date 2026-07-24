export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SourceCrop {
  readonly sx: number;
  readonly sy: number;
  readonly size: number;
}

export function coverScale(natural: Size, viewport: number): number {
  return Math.max(viewport / natural.width, viewport / natural.height);
}

export function maxOffset(natural: Size, viewport: number, zoom: number): Point {
  const scale = coverScale(natural, viewport) * zoom;
  return {
    x: Math.max(0, (natural.width * scale - viewport) / 2),
    y: Math.max(0, (natural.height * scale - viewport) / 2),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampOffset(offset: Point, natural: Size, viewport: number, zoom: number): Point {
  const limit = maxOffset(natural, viewport, zoom);
  return { x: clamp(offset.x, -limit.x, limit.x), y: clamp(offset.y, -limit.y, limit.y) };
}

export function sourceCrop(
  natural: Size,
  viewport: number,
  zoom: number,
  offset: Point,
): SourceCrop {
  const scale = coverScale(natural, viewport) * zoom;
  const displayWidth = natural.width * scale;
  const displayHeight = natural.height * scale;
  const size = viewport / scale;
  const sx = ((displayWidth - viewport) / 2 - offset.x) / scale;
  const sy = ((displayHeight - viewport) / 2 - offset.y) / scale;
  return {
    sx: clamp(sx, 0, Math.max(0, natural.width - size)),
    sy: clamp(sy, 0, Math.max(0, natural.height - size)),
    size,
  };
}

export function displayGeometry(
  natural: Size,
  viewport: number,
  zoom: number,
  offset: Point,
): {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
} {
  const scale = coverScale(natural, viewport) * zoom;
  const width = natural.width * scale;
  const height = natural.height * scale;
  return {
    width,
    height,
    left: (viewport - width) / 2 + offset.x,
    top: (viewport - height) / 2 + offset.y,
  };
}
