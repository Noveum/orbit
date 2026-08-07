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

export interface SearchTerm {
  readonly settled: string;
  readonly enabled: boolean;
  readonly answers: boolean;
  readonly behind: boolean;
}

export function useSearchTerm(term: string): SearchTerm {
  const typed = term.trim();
  const settled = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  const enabled = settled.length >= SEARCH_MIN_LENGTH;
  const answers = enabled && settled === typed;
  return { settled, enabled, answers, behind: typed.length >= SEARCH_MIN_LENGTH && !answers };
}
