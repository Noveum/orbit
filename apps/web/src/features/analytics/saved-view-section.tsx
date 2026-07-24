import type { Measure } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { loadSavedViews } from './data.ts';
import { SavedViewBar } from './saved-view-bar.tsx';

export async function SavedViewSection({
  principal,
  measure,
  canManage,
}: {
  readonly principal: Principal;
  readonly measure: Measure;
  readonly canManage: boolean;
}) {
  const savedViews = await loadSavedViews(principal);
  return <SavedViewBar views={savedViews} measure={measure} canManage={canManage} />;
}
