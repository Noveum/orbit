import { describe, expect, it } from 'bun:test';
import { clampOffset, coverScale, displayGeometry, maxOffset, sourceCrop } from './crop.ts';

const viewport = 300;

describe('crop geometry', () => {
  it('covers the viewport by scaling the shorter side', () => {
    expect(coverScale({ width: 600, height: 900 }, viewport)).toBe(0.5);
    expect(coverScale({ width: 900, height: 600 }, viewport)).toBe(0.5);
  });

  it('has no pannable room for a square image at zoom 1', () => {
    expect(maxOffset({ width: 600, height: 600 }, viewport, 1)).toEqual({ x: 0, y: 0 });
  });

  it('allows panning along the longer axis', () => {
    const limit = maxOffset({ width: 600, height: 1200 }, viewport, 1);
    expect(limit.x).toBe(0);
    expect(limit.y).toBeGreaterThan(0);
  });

  it('clamps an offset within the pannable room', () => {
    const natural = { width: 600, height: 1200 };
    const clamped = clampOffset({ x: 9999, y: 9999 }, natural, viewport, 1);
    const limit = maxOffset(natural, viewport, 1);
    expect(clamped).toEqual({ x: limit.x, y: limit.y });
  });

  it('crops the centre square of a centred square image', () => {
    const crop = sourceCrop({ width: 800, height: 800 }, viewport, 1, { x: 0, y: 0 });
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe(0);
    expect(crop.size).toBe(800);
  });

  it('shrinks the source region as zoom increases', () => {
    const wide = sourceCrop({ width: 800, height: 800 }, viewport, 1, { x: 0, y: 0 });
    const tight = sourceCrop({ width: 800, height: 800 }, viewport, 2, { x: 0, y: 0 });
    expect(tight.size).toBeLessThan(wide.size);
  });

  it('keeps the source crop inside the image bounds', () => {
    const natural = { width: 800, height: 1200 };
    const crop = sourceCrop(natural, viewport, 1, { x: 0, y: -99999 });
    expect(crop.sy).toBeGreaterThanOrEqual(0);
    expect(crop.sy + crop.size).toBeLessThanOrEqual(natural.height + 0.001);
  });

  it('positions the display image to cover the viewport', () => {
    const geo = displayGeometry({ width: 600, height: 600 }, viewport, 1, { x: 0, y: 0 });
    expect(geo.width).toBe(300);
    expect(geo.left).toBe(0);
    expect(geo.top).toBe(0);
  });
});
