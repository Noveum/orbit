'use client';

import type { ViewCapability } from '@orbit/shared/filters';
import { capabilityFor } from '@orbit/shared/filters';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { DisplayMenu } from './display-menu.tsx';
import type { ViewConfig, ViewLayoutMode, ViewPage } from './view-config.ts';
import { displayIsDefault } from './view-config.ts';

export interface ViewControls {
  readonly capability: ViewCapability;
  readonly displayModified: boolean;
  readonly config: ViewConfig | null;
  readonly layout: ViewLayoutMode;
  readonly onChange: ((next: ViewConfig) => void) | null;
}

const FALLBACK: ViewControls = {
  capability: capabilityFor('team', 'list'),
  displayModified: false,
  config: null,
  layout: 'list',
  onChange: null,
};

const ViewControlsContext = createContext<ViewControls>(FALLBACK);
const RegisterContext = createContext<(controls: ViewControls | null) => void>(() => undefined);

export function useViewControls(): ViewControls {
  return useContext(ViewControlsContext);
}

export function ViewControlsHost({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<ViewControls | null>(null);
  return (
    <RegisterContext.Provider value={setControls}>
      <ViewControlsContext.Provider value={controls ?? FALLBACK}>
        {children}
      </ViewControlsContext.Provider>
    </RegisterContext.Provider>
  );
}

export function useProvideViewControls(
  page: ViewPage,
  layout: ViewLayoutMode,
  config: ViewConfig,
  onChange: (next: ViewConfig) => void,
): ViewControls {
  const register = useContext(RegisterContext);
  const controls = useMemo<ViewControls>(
    () => ({
      capability: capabilityFor(page, layout),
      displayModified: !displayIsDefault(config, layout),
      config,
      layout,
      onChange,
    }),
    [page, layout, config, onChange],
  );

  useEffect(() => {
    register(controls);
    return () => register(null);
  }, [register, controls]);

  return controls;
}

export function TopBarDisplayMenu() {
  const controls = useViewControls();
  if (controls.config === null || controls.onChange === null) return null;
  return (
    <DisplayMenu
      compact
      config={controls.config}
      capability={controls.capability}
      modified={controls.displayModified}
      onChange={controls.onChange}
    />
  );
}
