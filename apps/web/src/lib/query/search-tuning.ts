'use client';

import { useEffect, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 140;
export const SEARCH_MIN_LENGTH = 2;

export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
