import { laneSuffix } from '../../../scripts/test-env.ts';

export const BASE_TEST_DATABASES = [
  'orbit_test_core',
  'orbit_test_svc',
  'orbit_test_rt',
  'orbit_test_rts',
  'orbit_test_mcp',
  'orbit_test_web',
] as const;

const BASE_DATABASES: ReadonlySet<string> = new Set(BASE_TEST_DATABASES);
const LANE_SUFFIX = /^[a-z0-9]+$/;

export const NO_LANE_REFUSAL =
  'ORBIT_TEST_LANE is not set, so there is no lane to drop. Set it to the lane you want removed, for example ORBIT_TEST_LANE=wf-1 bun run db:test-lanes-drop. Pass --all only when you want every lane on this Postgres gone, including the lanes other worktrees are running against right now.';

export type LaneDropTarget =
  | { readonly mode: 'lane'; readonly lane: string }
  | { readonly mode: 'all' }
  | { readonly mode: 'refused'; readonly reason: string };

export function laneOfDatabase(database: string): string | undefined {
  if (BASE_DATABASES.has(database)) return undefined;
  for (const base of BASE_TEST_DATABASES) {
    const prefix = `${base}_`;
    if (!database.startsWith(prefix)) continue;
    const suffix = database.slice(prefix.length);
    if (LANE_SUFFIX.test(suffix)) return suffix;
  }
  return undefined;
}

export function laneDropTarget(argv: readonly string[], lane: string | undefined): LaneDropTarget {
  const args = argv.filter((arg) => arg !== '--');
  const unknown = args.filter((arg) => arg !== '--all');
  if (unknown.length > 0) {
    return {
      mode: 'refused',
      reason: `Refusing to drop anything: ${unknown.join(' ')} is not an argument this script takes. The only argument is --all.`,
    };
  }
  if (args.includes('--all')) return { mode: 'all' };

  const suffix = laneSuffix(lane);
  if (suffix.length === 0) return { mode: 'refused', reason: NO_LANE_REFUSAL };
  return { mode: 'lane', lane: suffix };
}

export function databasesToDrop(
  target: LaneDropTarget,
  existing: readonly string[],
): readonly string[] {
  if (target.mode === 'refused') return [];
  if (target.mode === 'all') return existing.filter((name) => laneOfDatabase(name) !== undefined);
  return existing.filter((name) => laneOfDatabase(name) === target.lane);
}
