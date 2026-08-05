'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'blocked';

export const AUTOSAVE_DELAY_MS = 1200;

export interface AutosaveOptions<T> {
  readonly value: T;
  readonly save: (value: T) => Promise<unknown>;
  readonly delayMs?: number;
  readonly canSave?: (value: T) => boolean;
}

export interface Autosave {
  readonly status: SaveStatus;
  readonly saveNow: () => void;
}

function settledStatus<T>(
  current: T,
  saved: T,
  canSave: ((value: T) => boolean) | undefined,
): SaveStatus {
  if (Object.is(current, saved)) return 'saved';
  return canSave !== undefined && !canSave(current) ? 'blocked' : 'unsaved';
}

export function useAutosave<T>({
  value,
  save,
  delayMs = AUTOSAVE_DELAY_MS,
  canSave,
}: AutosaveOptions<T>) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const savedRef = useRef<T>(value);
  const valueRef = useRef<T>(value);
  const saveRef = useRef(save);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const againRef = useRef(false);

  const canSaveRef = useRef(canSave);
  saveRef.current = save;
  valueRef.current = value;
  canSaveRef.current = canSave;

  const run = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (runningRef.current) {
      againRef.current = true;
      return;
    }
    const pending = valueRef.current;
    if (Object.is(pending, savedRef.current)) return;
    const allowed = canSaveRef.current;
    if (allowed !== undefined && !allowed(pending)) {
      setStatus('blocked');
      return;
    }
    runningRef.current = true;
    setStatus('saving');
    saveRef
      .current(pending)
      .then(() => {
        savedRef.current = pending;
        setStatus(settledStatus(valueRef.current, pending, canSaveRef.current));
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        runningRef.current = false;
        if (!againRef.current) return;
        againRef.current = false;
        run();
      });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const leaving = () => run();
    const hiding = () => {
      if (document.visibilityState === 'hidden') run();
    };
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', hiding);
    return () => {
      window.removeEventListener('pagehide', leaving);
      document.removeEventListener('visibilitychange', hiding);
    };
  }, [run]);

  useEffect(() => {
    if (Object.is(value, savedRef.current)) return;
    const allowed = canSaveRef.current;
    setStatus(allowed !== undefined && !allowed(value) ? 'blocked' : 'unsaved');
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(run, delayMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [value, delayMs, run]);

  const autosave: Autosave = { status, saveNow: run };
  return autosave;
}
