import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import { activeCycle, cycleProgress, listCycles, updateCycle } from './cycle-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('repro', () => {
  it('poison the bootstrap active cycle', async () => {
    const [first] = await listCycles(workspace.admin, workspace.teamId);
    if (first === undefined) throw new Error('no cycle');
    let err: unknown = null;
    try {
      await updateCycle(workspace.admin, first.id, { startsAt: '0100-01-01' });
    } catch (error) {
      err = error;
    }
    console.log('UPDATE RESULT:', err === null ? 'OK' : String(err));
    const live = await activeCycle(workspace.admin, workspace.teamId);
    console.log('ACTIVE:', live === undefined ? 'none' : live.startsAt.toISOString());
    if (live !== undefined) {
      const t0 = performance.now();
      const p = await cycleProgress(workspace.admin, live.id);
      const t1 = performance.now();
      console.log(
        'points',
        p.burnUp.length,
        'ms',
        (t1 - t0).toFixed(0),
        'bytes',
        JSON.stringify(p).length,
      );
    }
    expect(true).toBe(true);
  });
});
