'use client';

import type { PresenceKind, PresenceMessage, SyncAction } from '@orbit/shared/events';
import { isFresh, PRESENCE_TTL_MS } from '@orbit/shared/events';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRealtimeClient, type RealtimeClient, type RealtimeStatus } from './index.ts';

export type DeltaHandler = (actions: SyncAction[]) => void;
export type ResumeHandler = (since: number) => void;

type PresenceByScope = ReadonlyMap<string, readonly PresenceMessage[]>;

interface RealtimeContextValue {
  status: RealtimeStatus;
  presence: PresenceByScope;
  retainScopes: (scopes: readonly string[]) => () => void;
  addDeltaHandler: (handler: DeltaHandler) => () => void;
  addResumeHandler: (handler: ResumeHandler) => () => void;
  observeSyncId: (syncId: number) => void;
  publishPresence: (scope: string, kind: PresenceKind) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const EMPTY_PRESENCE: readonly PresenceMessage[] = [];

const SCOPE_SEPARATOR = '\u0000';

function mergePresence(current: PresenceByScope, messages: readonly PresenceMessage[]) {
  const next = new Map(current);
  for (const message of messages) {
    const others = (next.get(message.scope) ?? []).filter(
      (entry) => entry.userId !== message.userId,
    );
    next.set(message.scope, [...others, message]);
  }
  return next as PresenceByScope;
}

export interface RealtimeProviderProps {
  url: string;
  token: string;
  organizationId: string;
  children: ReactNode;
}

export function RealtimeProvider({ url, token, organizationId, children }: RealtimeProviderProps) {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [presence, setPresence] = useState<PresenceByScope>(() => new Map());
  const clientRef = useRef<RealtimeClient | null>(null);
  const configRef = useRef('');
  const handlersRef = useRef(new Set<DeltaHandler>());
  const resumeHandlersRef = useRef(new Set<ResumeHandler>());
  const countsRef = useRef(new Map<string, number>());
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (closeTimerRef.current !== undefined) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    const config = `${url}${SCOPE_SEPARATOR}${token}${SCOPE_SEPARATOR}${organizationId}`;
    if (clientRef.current !== null && configRef.current !== config) {
      clientRef.current.close();
      clientRef.current = null;
    }
    if (clientRef.current === null) {
      configRef.current = config;
      clientRef.current = createRealtimeClient({
        url,
        token,
        organizationId,
        onStatus: (next) => {
          if (next !== 'open') setPresence(new Map());
          setStatus(next);
        },
        onDelta: (actions) => {
          for (const handler of handlersRef.current) handler(actions);
        },
        onResume: (since) => {
          setPresence(new Map());
          for (const handler of resumeHandlersRef.current) handler(since);
        },
        onPresence: (messages) => setPresence((current) => mergePresence(current, messages)),
      });
      const retained = [...countsRef.current.keys()];
      if (retained.length > 0) clientRef.current.subscribe(retained);
    }
    return () => {
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = undefined;
        clientRef.current?.close();
        clientRef.current = null;
      }, 0);
    };
  }, [url, token, organizationId]);

  const retainScopes = useCallback((requested: readonly string[]) => {
    const counts = countsRef.current;
    const added: string[] = [];
    for (const scope of requested) {
      const next = (counts.get(scope) ?? 0) + 1;
      counts.set(scope, next);
      if (next === 1) added.push(scope);
    }
    if (added.length > 0) clientRef.current?.subscribe(added);
    return () => {
      const removed: string[] = [];
      for (const scope of requested) {
        const next = (counts.get(scope) ?? 1) - 1;
        if (next > 0) {
          counts.set(scope, next);
          continue;
        }
        counts.delete(scope);
        removed.push(scope);
      }
      if (removed.length > 0) clientRef.current?.unsubscribe(removed);
    };
  }, []);

  const addDeltaHandler = useCallback((handler: DeltaHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const addResumeHandler = useCallback((handler: ResumeHandler) => {
    resumeHandlersRef.current.add(handler);
    return () => {
      resumeHandlersRef.current.delete(handler);
    };
  }, []);

  const observeSyncId = useCallback((syncId: number) => {
    clientRef.current?.observe(syncId);
  }, []);

  const publishPresence = useCallback((scope: string, kind: PresenceKind) => {
    clientRef.current?.setPresence(scope, kind);
  }, []);

  const value = useMemo(
    () => ({
      status,
      presence,
      retainScopes,
      addDeltaHandler,
      addResumeHandler,
      observeSyncId,
      publishPresence,
    }),
    [
      status,
      presence,
      retainScopes,
      addDeltaHandler,
      addResumeHandler,
      observeSyncId,
      publishPresence,
    ],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

function useRealtimeContext(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (value === null) throw new Error('Realtime hooks require a RealtimeProvider ancestor.');
  return value;
}

export function useRealtimeStatus(): RealtimeStatus {
  return useRealtimeContext().status;
}

export function useScopeSubscription(scopes: readonly string[]): void {
  const { retainScopes } = useRealtimeContext();
  const key = scopes.join(SCOPE_SEPARATOR);
  useEffect(() => retainScopes(key === '' ? [] : key.split(SCOPE_SEPARATOR)), [key, retainScopes]);
}

export interface ScopePresence {
  others: readonly PresenceMessage[];
  setPresence: (kind: PresenceKind) => void;
}

export function usePresence(scope: string): ScopePresence {
  const { presence, retainScopes, publishPresence } = useRealtimeContext();
  useEffect(() => retainScopes([scope]), [scope, retainScopes]);
  const setPresence = useCallback(
    (kind: PresenceKind) => publishPresence(scope, kind),
    [scope, publishPresence],
  );
  const stored = presence.get(scope) ?? EMPTY_PRESENCE;
  const others = useMemo(
    () => stored.filter((message) => isFresh(message.at, PRESENCE_TTL_MS)),
    [stored],
  );
  return { others, setPresence };
}

export function useDeltaHandler(handler: DeltaHandler): void {
  const { addDeltaHandler } = useRealtimeContext();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => addDeltaHandler((actions) => handlerRef.current(actions)), [addDeltaHandler]);
}

export function useResumeHandler(handler: ResumeHandler): void {
  const { addResumeHandler } = useRealtimeContext();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => addResumeHandler((since) => handlerRef.current(since)), [addResumeHandler]);
}

export function useObserveSyncId(): (syncId: number) => void {
  return useRealtimeContext().observeSyncId;
}
