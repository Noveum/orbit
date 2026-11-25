'use client';

import { useLayoutEffect, useRef, useState } from 'react';

export function useRowFits(enabled: boolean) {
  const container = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLFieldSetElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const box = container.current;
    const line = row.current;
    if (!enabled || box === null || line === null) return;
    const measure = () => setFits(line.scrollWidth <= box.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(line);
    return () => observer.disconnect();
  }, [enabled]);

  return { container, row, fits: !enabled || fits };
}
