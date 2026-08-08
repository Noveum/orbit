import { describe, expect, it } from 'bun:test';
import { laneSuffix } from '../../../scripts/test-env.ts';
import {
  BASE_TEST_DATABASES,
  databasesToDrop,
  laneDropTarget,
  laneOfDatabase,
} from '../src/test-lane-drop.ts';

const mine = laneSuffix('wf-mine');
const theirs = laneSuffix('wf-theirs');

function databasesOf(lane: string): string[] {
  return BASE_TEST_DATABASES.map((base) => `${base}_${lane}`);
}

const existing = [...BASE_TEST_DATABASES, ...databasesOf(mine), ...databasesOf(theirs)];

describe('laneOfDatabase', () => {
  it('reads the lane back out of a lane database', () => {
    expect(laneOfDatabase(`orbit_test_core_${mine}`)).toBe(mine);
    expect(laneOfDatabase(`orbit_test_rts_${mine}`)).toBe(mine);
  });

  it('never reads a lane out of one of the six base databases', () => {
    for (const base of BASE_TEST_DATABASES) {
      expect(laneOfDatabase(base)).toBeUndefined();
    }
  });

  it('ignores anything that is not a lane database', () => {
    expect(laneOfDatabase('orbit')).toBeUndefined();
    expect(laneOfDatabase('orbit_test')).toBeUndefined();
    expect(laneOfDatabase('orbit_test_corex')).toBeUndefined();
    expect(laneOfDatabase('orbit_test_other_alpha')).toBeUndefined();
    expect(laneOfDatabase('orbit_test_core_alpha_beta')).toBeUndefined();
    expect(laneOfDatabase('orbit_test_core_ALPHA')).toBeUndefined();
  });

  it('keeps the two bases that share a prefix apart', () => {
    expect(laneOfDatabase(`orbit_test_rts_${mine}`)).toBe(mine);
    expect(laneOfDatabase('orbit_test_rts')).toBeUndefined();
  });
});

describe('laneDropTarget', () => {
  it('targets the lane named by ORBIT_TEST_LANE', () => {
    expect(laneDropTarget([], 'wf-mine')).toEqual({ mode: 'lane', lane: mine });
  });

  it('normalises the lane exactly the way the test databases are named', () => {
    const target = laneDropTarget([], 'Agent-7');
    expect(target).toEqual({ mode: 'lane', lane: laneSuffix('Agent-7') });
  });

  it('refuses when no lane is set and no --all is passed', () => {
    const target = laneDropTarget([], undefined);
    expect(target.mode).toBe('refused');
    if (target.mode !== 'refused') throw new Error('expected a refusal');
    expect(target.reason).toContain('ORBIT_TEST_LANE');
    expect(target.reason).toContain('--all');
  });

  it('refuses a lane that is only whitespace', () => {
    expect(laneDropTarget([], '   ').mode).toBe('refused');
    expect(laneDropTarget([], '').mode).toBe('refused');
  });

  it('takes --all as the whole fleet', () => {
    expect(laneDropTarget(['--all'], undefined)).toEqual({ mode: 'all' });
    expect(laneDropTarget(['--', '--all'], 'wf-mine')).toEqual({ mode: 'all' });
  });

  it('refuses an argument it does not recognise rather than guessing', () => {
    const target = laneDropTarget(['--al'], 'wf-mine');
    expect(target.mode).toBe('refused');
    if (target.mode !== 'refused') throw new Error('expected a refusal');
    expect(target.reason).toContain('--al');
  });
});

describe('databasesToDrop', () => {
  it('selects exactly the databases of the lane it was given', () => {
    const doomed = databasesToDrop(laneDropTarget([], 'wf-mine'), existing);
    expect([...doomed].sort()).toEqual([...databasesOf(mine)].sort());
  });

  it('never selects one of the six base databases', () => {
    const lane = databasesToDrop(laneDropTarget([], 'wf-mine'), existing);
    const all = databasesToDrop(laneDropTarget(['--all'], undefined), existing);
    for (const base of BASE_TEST_DATABASES) {
      expect(lane).not.toContain(base);
      expect(all).not.toContain(base);
    }
  });

  it('never selects another lane, which is the whole point of a lane', () => {
    const doomed = databasesToDrop(laneDropTarget([], 'wf-mine'), existing);
    for (const database of databasesOf(theirs)) {
      expect(doomed).not.toContain(database);
    }
  });

  it('keeps two lanes apart even when normalising makes them look alike', () => {
    const raw = ['wf/1', 'wf-1'] as const;
    const lanes = raw.map((value) => laneSuffix(value));
    const rows = lanes.flatMap((lane) => databasesOf(lane));
    const doomed = databasesToDrop(laneDropTarget([], raw[0]), rows);

    expect([...doomed].sort()).toEqual([...databasesOf(lanes[0] ?? '')].sort());
    expect(doomed).toHaveLength(BASE_TEST_DATABASES.length);
  });

  it('selects every lane under --all, and still nothing else', () => {
    const doomed = databasesToDrop(laneDropTarget(['--all'], undefined), existing);
    expect([...doomed].sort()).toEqual([...databasesOf(mine), ...databasesOf(theirs)].sort());
  });

  it('selects nothing when it refused', () => {
    expect(databasesToDrop(laneDropTarget([], undefined), existing)).toEqual([]);
    expect(databasesToDrop(laneDropTarget(['--al'], 'wf-mine'), existing)).toEqual([]);
  });

  it('selects nothing when the lane has no databases yet', () => {
    expect(databasesToDrop(laneDropTarget([], 'wf-unused'), existing)).toEqual([]);
  });
});
