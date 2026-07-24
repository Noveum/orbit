import type { Measure } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { CyclePanel } from './cycle-panel.tsx';
import { loadCycleOptions } from './data.ts';

export async function CycleSection({
  principal,
  measure,
  canManage,
}: {
  readonly principal: Principal;
  readonly measure: Measure;
  readonly canManage: boolean;
}) {
  const cycles = await loadCycleOptions(principal);
  return <CyclePanel cycles={cycles} measure={measure} canManage={canManage} />;
}
