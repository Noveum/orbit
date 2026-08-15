import { type RefObject, useEffect, useRef, useState } from 'react';

export function useMeasuredWidth(fallback = 640): {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly width: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(node);
    setWidth(Math.round(node.getBoundingClientRect().width) || fallback);
    return () => observer.disconnect();
  }, [fallback]);
  return { ref, width };
}
