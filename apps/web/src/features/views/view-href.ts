import { withViewParam } from '@/features/filters/use-view-config.ts';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { viewConfigFromState, viewConfigSearch } from '@/features/filters/view-config.ts';
import type { ViewScopeSource } from '@/features/views/view-scope.ts';
import { resolveViewScope } from '@/features/views/view-scope.ts';
import type { View } from '@/lib/query/schemas.ts';

export const STANDUP_VIEW_ID = 'virtual:standup';

export function viewLayoutMode(layout: string): ViewLayoutMode {
  return layout === 'board' ? 'board' : 'list';
}

export function savedViewPath(viewId: string): string {
  return `/views/${encodeURIComponent(viewId)}`;
}

export function viewHref(view: View, source: ViewScopeSource): string {
  if (view.id === STANDUP_VIEW_ID) return '/standup';

  const team = resolveViewScope(view, source).team;
  if (team === null) return savedViewPath(view.id);

  const layout = viewLayoutMode(view.layout);
  const search = viewConfigSearch(viewConfigFromState(view.filter), layout);
  const page = layout === 'board' ? 'board' : 'issues';
  return `/team/${team.key.toLowerCase()}/${page}${withViewParam(search, view.id)}`;
}
