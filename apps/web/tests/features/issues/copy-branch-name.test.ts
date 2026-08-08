import { describe, expect, it } from 'bun:test';
import { branchCopy, branchNameFor } from '../../../src/features/issues/copy-branch-name.tsx';

describe('branchNameFor', () => {
  it('builds the name a developer would check out', () => {
    expect(
      branchNameFor({ identifier: 'ENG-42', title: 'Fan out delta packets' }, 'shashank'),
    ).toBe('shashank/eng-42-fan-out-delta-packets');
  });

  it('falls back to orbit when the person has no handle yet', () => {
    expect(branchNameFor({ identifier: 'ENG-42', title: 'Ship it' }, null)).toBe(
      'orbit/eng-42-ship-it',
    );
  });

  it('keeps the identifier when a title slugifies to nothing', () => {
    expect(branchNameFor({ identifier: 'ENG-7', title: '!!!' }, 'ada')).toBe('ada/eng-7');
  });

  it('lowercases the identifier so the branch reads the way git branches do', () => {
    expect(branchNameFor({ identifier: 'MKT-3', title: 'Launch' }, 'bo')).toBe('bo/mkt-3-launch');
  });

  it('trims a long title rather than producing an unusable branch', () => {
    const name = branchNameFor(
      {
        identifier: 'ENG-1',
        title: 'A title that goes on well past anything anybody would want to type out by hand',
      },
      'ada',
    );

    expect(name.startsWith('ada/eng-1-')).toBe(true);
    expect(name.length).toBeLessThanOrEqual('ada/eng-1-'.length + 48);
    expect(name.endsWith('-')).toBe(false);
  });
});

const member = { id: 'user_1', handle: 'shashank' };
const target = { identifier: 'ENG-42', title: 'Fan out delta packets' };

describe('branchCopy', () => {
  it('offers the signed in member branch once the workspace has loaded', () => {
    const state = branchCopy(
      { ready: true, userId: 'user_1', memberById: new Map([['user_1', member]]) },
      target,
    );

    expect(state).toEqual({ branch: 'shashank/eng-42-fan-out-delta-packets', ready: true });
  });

  it('withholds the copy until the workspace has loaded, so nobody takes the orbit fallback for their own handle', () => {
    const state = branchCopy({ ready: false, userId: null, memberById: new Map() }, target);

    expect(state.ready).toBe(false);
  });

  it('stays offered for a loaded member who has no handle set', () => {
    const state = branchCopy(
      {
        ready: true,
        userId: 'user_1',
        memberById: new Map([['user_1', { ...member, handle: null }]]),
      },
      target,
    );

    expect(state).toEqual({ branch: 'orbit/eng-42-fan-out-delta-packets', ready: true });
  });
});
