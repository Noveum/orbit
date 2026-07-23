'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export const AUTOSAVE_DELAY_MS = 1200;

export interface AutosaveOptions<T> {
  readonly value: T;
  readonly save: (value: T) => Promise<unknown>;
  readonly delayMs?: number;
}

export interface Autosave {
  readonly status: SaveStatus;
  readonly saveNow: () => void;
}

export function useAutosave<T>({ value, save, delayMs = AUTOSAVE_DELAY_MS }: AutosaveOptions<T>) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const savedRef = useRef<T>(value);
  const valueRef = useRef<T>(value);
  const saveRef = useRef(save);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  saveRef.current = save;
  valueRef.current = value;

  const run = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = valueRef.current;
    if (Object.is(pending, savedRef.current)) return;
    setStatus('saving');
    saveRef
      .current(pending)
      .then(() => {
        savedRef.current = pending;
        setStatus(Object.is(valueRef.current, pending) ? 'saved' : 'unsaved');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    if (Object.is(value, savedRef.current)) return;
    setStatus('unsaved');
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(run, delayMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [value, delayMs, run]);

  const autosave: Autosave = { status, saveNow: run };
  return autosave;
}
