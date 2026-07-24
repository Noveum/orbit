'use client';

import { createContext, useContext } from 'react';

export interface DocsTreeControl {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
  readonly unsavedDocId: string | null;
  readonly setUnsavedDocId: (docId: string | null) => void;
}

const noop: DocsTreeControl = {
  open: false,
  toggle: () => undefined,
  close: () => undefined,
  unsavedDocId: null,
  setUnsavedDocId: () => undefined,
};

const DocsTreeContext = createContext<DocsTreeControl>(noop);

export const DocsTreeProvider = DocsTreeContext.Provider;

export function useDocsTree(): DocsTreeControl {
  return useContext(DocsTreeContext);
}
