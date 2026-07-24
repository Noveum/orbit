'use client';

import type { ViewCapability } from '@orbit/shared/filters';
import { capabilityFor } from '@orbit/shared/filters';
import { useMemo } from 'react';
import type { ViewConfig, ViewLayoutMode, ViewPage } from './view-config.ts';
import { displayIsDefault } from './view-config.ts';

export interface ViewControls {
  readonly capability: ViewCapability;
  readonly displayModified: boolean;
}

export function useProvideViewControls(
  page: ViewPage,
  layout: ViewLayoutMode,
  config: ViewConfig,
): ViewControls {
  return useMemo<ViewControls>(
    () => ({
      capability: capabilityFor(page, layout),
      displayModified: !displayIsDefault(config, layout),
    }),
    [page, layout, config],
  );
}
