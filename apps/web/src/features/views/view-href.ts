import { withViewParam } from '@/features/filters/use-view-config.ts';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { viewConfigFromState, viewConfigSearch } from '@/features/filters/view-config.ts';
import type { Team, View } from '@/lib/query/schemas.ts';

export const STANDUP_VIEW_ID = 'virtual:standup';

export function viewLayoutMode(layout: string): ViewLayoutMode {
  return layout === 'board' ? 'board' : 'list';
}

export function savedViewPath(viewId: string): string {
  return `/views/${encodeURIComponent(viewId)}`;
}

export function viewHref(view: View, teams: readonly Team[]): string {
  if (view.id === STANDUP_VIEW_ID) return '/standup';

  const teamId = view.filter.teamId;
  const team = teamId === null ? undefined : teams.find((entry) => entry.id === teamId);
  if (team === undefined) return savedViewPath(view.id);

  const layout = viewLayoutMode(view.layout);
  const search = viewConfigSearch(viewConfigFromState(view.filter), layout);
  const page = layout === 'board' ? 'board' : 'issues';
  return `/team/${team.key.toLowerCase()}/${page}${withViewParam(search, view.id)}`;
}
