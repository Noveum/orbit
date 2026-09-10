'use client';

import { createContext, useContext } from 'react';

export interface SettingsNavControl {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
}

const noop: SettingsNavControl = {
  open: false,
  toggle: () => undefined,
  close: () => undefined,
};

const SettingsNavContext = createContext<SettingsNavControl>(noop);

export const SettingsNavProvider = SettingsNavContext.Provider;

export function useSettingsNav(): SettingsNavControl {
  return useContext(SettingsNavContext);
}
