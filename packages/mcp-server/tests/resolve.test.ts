import { beforeAll, describe, expect, it } from 'bun:test';
import {
  createCycle,
  createLabel,
  createProject,
  createTeam,
  deleteLabel,
  listCycles,
  listProjects,
  listTeams,
} from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { sprintLabel } from '@orbit/shared/utils';
import {
  resolveCycle,
  resolveLabelIds,
  resolveProject,
  resolveStateId,
  resolveTeam,
  resolveUserId,
} from '../src/resolve.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type TestWorkspace,
} from '../src/test-helpers.ts';

let workspace: TestWorkspace;
let admin: Principal;
let engineeringId: string;
let designId: string;
let apolloId: string;
let apolloSlug: string;
let borealisId: string;
let borealisSlug: string;
let flakyLabelId: string;
let sturdyLabelId: string;
let teammateId: string;
let sprintOne: string;
let sprintTwo: string;
let sprintThree: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = workspace.admin;
  engineeringId = workspace.teamId;

  const design = await createTeam(admin, { name: 'Design', key: 'DES' });
  designId = design.team.id;

  const apollo = await createProject(admin, { name: 'Apollo Mission', teamIds: [engineeringId] });
  apolloId = apollo.project.id;
  apolloSlug = apollo.project.slug;
  const borealis = await createProject(admin, { name: 'Borealis Ridge', teamIds: [designId] });
  borealisId = borealis.project.id;
  borealisSlug = borealis.project.slug;

  const flaky = await createLabel(admin, { name: 'Flaky', color: '#ff0000', teamId: null });
  flakyLabelId = flaky.label.id;
  const sturdy = await createLabel(admin, { name: 'Sturdy', color: '#00ff00', teamId: null });
  sturdyLabelId = sturdy.label.id;

  const teammate = await addMember(workspace, 'member', 'Bea Builder');
  teammateId = teammate.user.id;

  const [bootstrap] = await listCycles(admin);
  if (bootstrap === undefined) throw new Error('the workspace has no sprint');
  sprintOne = bootstrap.id;

  const sprintTwoCreated = await createCycle(admin, {
    startsAt: daysFromNow(20),
    endsAt: daysFromNow(34),
  });
  sprintTwo = sprintTwoCreated.cycle.id;
  const sprintThreeCreated = await createCycle(admin, {
    startsAt: daysFromNow(40),
    endsAt: daysFromNow(54),
  });
  sprintThree = sprintThreeCreated.cycle.id;
});

async function errorOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    const thrown = error as { code?: unknown };
    return typeof thrown.code === 'string' ? thrown.code : 'not-a-domain-error';
  }
  throw new Error('the call was expected to throw and did not');
}

describe('the fixture has more than one of everything the resolvers pick from', () => {
  it('holds two teams and two projects, so position cannot stand in for matching', async () => {
    expect((await listTeams(admin)).length).toBeGreaterThan(1);
    expect((await listProjects(admin, {})).length).toBeGreaterThan(1);
    expect(engineeringId).not.toBe(designId);
    expect(apolloId).not.toBe(borealisId);
  });
});

describe('resolveTeam', () => {
  it('picks the second team by its key, its name and its id', async () => {
    expect((await resolveTeam(admin, 'DES')).id).toBe(designId);
    expect((await resolveTeam(admin, 'Design')).id).toBe(designId);
    expect((await resolveTeam(admin, designId)).id).toBe(designId);
  });

  it('picks the first team rather than whatever comes first in the list', async () => {
    expect((await resolveTeam(admin, workspace.teamKey)).id).toBe(engineeringId);
  });

  it('ignores case and surrounding space', async () => {
    expect((await resolveTeam(admin, '  des  ')).id).toBe(designId);
    expect((await resolveTeam(admin, 'dEsIgN')).id).toBe(designId);
  });

  it('refuses a reference that matches no team', async () => {
    expect(await errorOf(() => resolveTeam(admin, 'Marketing'))).toBe('not_found');
  });
});

describe('resolveProject', () => {
  it('picks the second project by its name, its slug and its id', async () => {
    expect((await resolveProject(admin, 'Borealis Ridge')).id).toBe(borealisId);
    expect((await resolveProject(admin, borealisSlug)).id).toBe(borealisId);
    expect((await resolveProject(admin, borealisId)).id).toBe(borealisId);
  });

  it('picks the first project when asked for it by name or slug', async () => {
    expect((await resolveProject(admin, 'Apollo Mission')).id).toBe(apolloId);
    expect((await resolveProject(admin, apolloSlug)).id).toBe(apolloId);
  });

  it('reads a slug that is not just the lowercased name', () => {
    expect(apolloSlug).not.toBe('apollo mission');
    expect(borealisSlug).not.toBe('borealis ridge');
    expect(apolloSlug).toContain('-');
  });

  it('refuses a reference that matches no project', async () => {
    expect(await errorOf(() => resolveProject(admin, 'Gemini'))).toBe('not_found');
  });
});

describe('resolveLabelIds', () => {
  it('maps each reference to its own label rather than to the first one', async () => {
    expect(await resolveLabelIds(admin, ['Sturdy'])).toEqual([sturdyLabelId]);
    expect(await resolveLabelIds(admin, ['Flaky'])).toEqual([flakyLabelId]);
  });

  it('keeps the order the caller asked for', async () => {
    expect(await resolveLabelIds(admin, ['Sturdy', 'Flaky'])).toEqual([
      sturdyLabelId,
      flakyLabelId,
    ]);
    expect(await resolveLabelIds(admin, ['Flaky', 'Sturdy'])).toEqual([
      flakyLabelId,
      sturdyLabelId,
    ]);
  });

  it('accepts an id as readily as a name', async () => {
    expect(await resolveLabelIds(admin, [sturdyLabelId])).toEqual([sturdyLabelId]);
  });

  it('returns nothing for an empty request and refuses an unknown label', async () => {
    expect(await resolveLabelIds(admin, [])).toEqual([]);
    expect(await errorOf(() => resolveLabelIds(admin, ['Sturdy', 'Nonesuch']))).toBe('not_found');
  });

  it('refuses to guess when a workspace label and a team label share a name', async () => {
    const twin = await createLabel(admin, { name: 'Flaky', color: '#0000ff', teamId: designId });

    expect(await errorOf(() => resolveLabelIds(admin, ['Flaky']))).toBe('conflict');
    expect(await errorOf(() => resolveLabelIds(admin, ['Flaky'], designId))).toBe('conflict');
    expect(await resolveLabelIds(admin, [twin.label.id])).toEqual([twin.label.id]);
    expect(await resolveLabelIds(admin, ['Flaky'], engineeringId)).toEqual([flakyLabelId]);
    expect(await resolveLabelIds(admin, ['Sturdy'])).toEqual([sturdyLabelId]);

    await deleteLabel(admin, twin.label.id);
  });
});

describe('resolveUserId', () => {
  it('picks the named member rather than the caller or the first row', async () => {
    expect(await resolveUserId(admin, 'Bea Builder')).toBe(teammateId);
    expect(await resolveUserId(admin, 'me')).toBe(admin.userId);
    expect(await resolveUserId(admin, 'Ada Admin')).toBe(admin.userId);
  });

  it('refuses a reference that matches nobody', async () => {
    expect(await errorOf(() => resolveUserId(admin, 'Nobody At All'))).toBe('not_found');
  });
});

describe('resolveStateId', () => {
  it('resolves a state on the team it was asked about', async () => {
    const onDesign = await resolveStateId(admin, designId, 'In Progress');
    const onEngineering = await resolveStateId(admin, engineeringId, 'In Progress');

    expect(onDesign).not.toBe(onEngineering);
    expect(await resolveStateId(admin, designId, onDesign)).toBe(onDesign);
  });

  it('refuses a state that belongs to another team', async () => {
    const onDesign = await resolveStateId(admin, designId, 'In Progress');
    expect(await errorOf(() => resolveStateId(admin, engineeringId, onDesign))).toBe('not_found');
  });
});

describe('the cycle fixture holds more than one sprint', () => {
  it('gives the workspace three sprints, only the first of which is running', async () => {
    const sprints = await listCycles(admin);

    expect(sprints.map((sprint) => sprint.id)).toEqual([sprintOne, sprintTwo, sprintThree]);
    expect(sprints.map((sprint) => sprintLabel(sprint))).toEqual([
      'Sprint 1',
      'Sprint 2',
      'Sprint 3',
    ]);
  });
});

describe('resolveCycle', () => {
  it('picks the third sprint by its name, its number and its id', async () => {
    expect((await resolveCycle(admin, 'Sprint 3')).id).toBe(sprintThree);
    expect((await resolveCycle(admin, '3')).id).toBe(sprintThree);
    expect((await resolveCycle(admin, sprintThree)).id).toBe(sprintThree);
  });

  it('picks the middle sprint rather than whatever comes first in the list', async () => {
    expect((await resolveCycle(admin, 'Sprint 2')).id).toBe(sprintTwo);
    expect((await resolveCycle(admin, '2')).id).toBe(sprintTwo);
  });

  it('ignores case and surrounding space', async () => {
    expect((await resolveCycle(admin, '  sprint 3  ')).id).toBe(sprintThree);
    expect((await resolveCycle(admin, 'SPRINT 2')).id).toBe(sprintTwo);
  });

  it('reads "active" as the sprint running on the team it was asked about', async () => {
    expect((await resolveCycle(admin, 'active')).id).toBe(sprintOne);
    expect((await resolveCycle(admin, 'active')).id).toBe(sprintOne);
    expect((await resolveCycle(admin, '  ACTIVE  ')).id).toBe(sprintOne);
  });

  it('refuses a sprint that belongs to another workspace', async () => {
    const vega = await createWorkspace('Vega');
    const [theirs] = await listCycles(vega.admin);
    if (theirs === undefined) throw new Error('vega has no sprint');

    expect(await errorOf(() => resolveCycle(admin, theirs.id))).toBe('not_found');
  });

  it('refuses a reference that matches no sprint', async () => {
    expect(await errorOf(() => resolveCycle(admin, 'Sprint 9'))).toBe('not_found');
    expect(await errorOf(() => resolveCycle(admin, '9'))).toBe('not_found');
  });

  it('resolves "active" to the sprint the workspace is running', async () => {
    expect((await resolveCycle(admin, 'active')).id).toBe(sprintOne);
  });
});
