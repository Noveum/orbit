'use client';

import { createContext, type ReactNode, useContext } from 'react';

const SessionContext = createContext<string | null>(null);

export function SessionProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <SessionContext.Provider value={userId}>{children}</SessionContext.Provider>;
}

export function useCurrentUserId(): string | null {
  return useContext(SessionContext);
}
