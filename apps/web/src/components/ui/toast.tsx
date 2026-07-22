'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '@/lib/cn.ts';

export const MAX_TOASTS = 3;

export type ToastTone = 'neutral' | 'success' | 'danger';

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  readonly durationMs?: number;
}

interface ToastRecord extends ToastOptions {
  readonly id: string;
}

interface ToastApi {
  readonly toast: (options: ToastOptions) => void;
  readonly dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast must be used inside ToastProvider');
  return api;
}

const TONE_CLASS: Record<ToastTone, string> = {
  neutral: 'text-text',
  success: 'text-success',
  danger: 'text-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const record: ToastRecord = { ...options, id: crypto.randomUUID() };
    setItems((current) => [...current, record].slice(-MAX_TOASTS));
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider swipeDirection="left" duration={5000}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            duration={item.durationMs ?? 5000}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className={cn(
              'flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-pop',
              'data-[state=closed]:animate-pop-out data-[state=open]:animate-toast-in',
              'data-[swipe=end]:animate-pop-out',
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastPrimitive.Title
                className={cn('font-medium text-dense', TONE_CLASS[item.tone ?? 'neutral'])}
              >
                {item.title}
              </ToastPrimitive.Title>
              {item.description ? (
                <ToastPrimitive.Description className="text-muted text-xs">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss"
              className="rounded-sm p-0.5 text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text"
            >
              <X className="size-3.5" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 left-0 z-100 flex w-max max-w-full flex-col-reverse gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
