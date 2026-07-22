'use client';

import { type RefObject, useEffect, useRef } from 'react';

export const DRAW_DURATION_MS = 300;
const DRAW_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

interface Drawable {
  getTotalLength?: () => number;
  animate?: Element['animate'];
}

export function useDrawOnMount<T extends Drawable>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (typeof node.getTotalLength !== 'function' || typeof node.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const length = node.getTotalLength();
    if (!Number.isFinite(length) || length === 0) return;
    node.animate(
      [
        { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
        { strokeDasharray: `${length}`, strokeDashoffset: '0' },
      ],
      { duration: DRAW_DURATION_MS, easing: DRAW_EASING },
    );
  }, []);

  return ref;
}
