import { beforeAll, describe, expect, it } from 'bun:test';
import { createLabel, createProject } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { bootstrapPayload, bootstrapVersion } from '../../../src/lib/api/bootstrap.ts';

let nova: Workspace;
let orion: Workspace;
let novaSecondTeam: string;
let novaProject: string;
let novaSharedProject: string;
let orionProject: string;

beforeAll(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');

  const [second] = await db
    .insert(schema.team)
    .values({
      id: 'team_nova_platform',
      organizationId: nova.organizationId,
      name: 'Platform',
      key: 'PLT',
    })
    .returning({ id: schema.team.id });
  novaSecondTeam = second?.id ?? '';
  await db
    .insert(schema.teamMember)
    .values({ id: 'tm_nova_platform', teamId: novaSecondTeam, userId: nova.adminUser.id });

  const solo = await createProject(nova.admin, { name: 'Nova only', teamIds: [nova.teamId] });
  novaProject = solo.project.id;
  const shared = await createProject(nova.admin, {
    name: 'Nova shared',
    teamIds: [nova.teamId, novaSecondTeam],
  });
  novaSharedProject = shared.project.id;
  const away = await createProject(orion.admin, { name: 'Orion only', teamIds: [orion.teamId] });
  orionProject = away.project.id;

  await createLabel(nova.admin, { name: 'Flaky', color: '#ff0000', teamId: null });
  await createLabel(orion.admin, { name: 'Flaky', color: '#00ff00', teamId: null });

  await db.insert(schema.workflowState).values({
    id: 'state_platform_todo',
    organizationId: nova.organizationId,
    teamId: novaSecondTeam,
    name: 'Platform only',
    category: 'unstarted',
    color: '#111111',
  });
  await db.insert(schema.cycle).values({
    id: 'cycle_platform',
    organizationId: nova.organizationId,
    teamId: novaSecondTeam,
    number: 1,
    name: 'Platform cycle',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-01-15T00:00:00.000Z'),
  });

  await db.insert(schema.workflowState).values({
    id: 'state_crossed_wires',
    organizationId: orion.organizationId,
    teamId: nova.teamId,
    name: 'Crossed wires',
    category: 'unstarted',
    color: '#222222',
  });
  await db.insert(schema.cycle).values({
    id: 'cycle_crossed_wires',
    organizationId: orion.organizationId,
    teamId: nova.teamId,
    number: 99,
    name: 'Crossed wires',
    startsAt: new Date('2026-02-01T00:00:00.000Z'),
    endsAt: new Date('2026-02-15T00:00:00.000Z'),
  });

  await addMember(nova, 'member', { name: 'Nova Person' });
  await addMember(orion, 'member', { name: 'Orion Person' });
});

describe('bootstrapPayload never leaks another workspace', () => {
  it('returns only the teams the principal can reach', async () => {
    const payload = await bootstrapPayload(nova.admin, {});

    expect(payload.organizationId).toBe(nova.organizationId);
    expect(payload.teams.map((team) => team.id).sort()).toEqual(
      [nova.teamId, novaSecondTeam].sort(),
    );
    expect(payload.teams.map((team) => team.id)).not.toContain(orion.teamId);
  });

  it('returns only the workflow states of the active workspace, even though the names collide', async () => {
    const payload = await bootstrapPayload(nova.admin, {});
    const orionStateIds = new Set(orion.states.map((state) => state.id));

    expect(payload.states.length).toBeGreaterThan(0);
    expect(payload.states.every((state) => !orionStateIds.has(state.id))).toBe(true);
    expect(payload.states.every((state) => state.teamId !== orion.teamId)).toBe(true);
    expect(payload.states.some((state) => state.name === 'In Progress')).toBe(true);
  });

  it('returns only the cycles of the active workspace', async () => {
    const payload = await bootstrapPayload(nova.admin, {});
    const orionCycles = await db
      .select({ id: schema.cycle.id })
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, orion.organizationId));
    const forbidden = new Set(orionCycles.map((row) => row.id));

    expect(payload.cycles.length).toBeGreaterThan(0);
    expect(payload.cycles.every((cycle) => !forbidden.has(cycle.id))).toBe(true);
  });

  it('drops a state or a cycle whose workspace and team disagree', async () => {
    const payload = await bootstrapPayload(nova.admin, {});

    expect(payload.states.map((state) => state.id)).not.toContain('state_crossed_wires');
    expect(payload.cycles.map((cycle) => cycle.id)).not.toContain('cycle_crossed_wires');
  });

  it('returns only the labels of the active workspace when both named one Flaky', async () => {
    const payload = await bootstrapPayload(nova.admin, {});

    expect(payload.labels.filter((label) => label.name === 'Flaky')).toHaveLength(1);
    expect(payload.labels.map((label) => label.color)).toContain('#ff0000');
    expect(payload.labels.map((label) => label.color)).not.toContain('#00ff00');
  });

  it('returns only the members of the active workspace', async () => {
    const payload = await bootstrapPayload(nova.admin, {});
    const names = payload.members.map((member) => member.name);

    expect(names).toContain('Nova Person');
    expect(names).not.toContain('Orion Person');
  });

  it('returns only the projects of the active workspace and the teams each one belongs to', async () => {
    const payload = await bootstrapPayload(nova.admin, {});
    const byId = new Map(payload.projects.map((project) => [project.id, project]));

    expect([...byId.keys()].sort()).toEqual([novaProject, novaSharedProject].sort());
    expect(byId.get(novaProject)?.teamIds).toEqual([nova.teamId]);
    expect(byId.get(novaSharedProject)?.teamIds.slice().sort()).toEqual(
      [nova.teamId, novaSecondTeam].sort(),
    );
    expect(byId.has(orionProject)).toBe(false);
  });

  it('picks the active team by key and falls back to the first team otherwise', async () => {
    const chosen = await bootstrapPayload(nova.admin, { team: 'PLT' });
    const fallback = await bootstrapPayload(nova.admin, { team: 'NOPE' });

    expect(chosen.activeTeamId).toBe(novaSecondTeam);
    expect(fallback.activeTeamId).toBe(chosen.teams[0]?.id ?? null);
  });

  it('shows a member only the teams they joined', async () => {
    const joiner = await addMember(nova, 'member', {
      name: 'One Team Only',
      teamIds: [nova.teamId],
    });

    const payload = await bootstrapPayload(joiner.principal, {});

    expect(payload.teams.map((team) => team.id)).toEqual([nova.teamId]);
    expect(payload.states.every((state) => state.teamId === nova.teamId)).toBe(true);
    expect(payload.states.map((state) => state.name)).not.toContain('Platform only');
    expect(payload.cycles.every((cycle) => cycle.teamId === nova.teamId)).toBe(true);
    expect(payload.cycles.map((cycle) => cycle.id)).not.toContain('cycle_platform');
    expect(payload.projects.map((project) => project.id).sort()).toEqual(
      [novaProject, novaSharedProject].sort(),
    );
  });
});

describe('bootstrapVersion keeps the weak etag user scoped', () => {
  it('never hands two members of one workspace the same etag version', async () => {
    const teammate = await addMember(nova, 'member', { name: 'Etag Person' });

    const admin = await bootstrapVersion(nova.admin);
    const other = await bootstrapVersion(teammate.principal);

    expect(admin).not.toBe(other);
    expect(admin.startsWith(`${nova.admin.userId}-`)).toBe(true);
    expect(other.startsWith(`${teammate.principal.userId}-`)).toBe(true);
  });

  it('separates the same user across two workspaces', async () => {
    const inNova = await bootstrapVersion(nova.admin);
    const inOrion = await bootstrapVersion({ ...nova.admin, organizationId: orion.organizationId });

    expect(inNova).not.toBe(inOrion);
    expect(inNova.includes(nova.organizationId)).toBe(true);
    expect(inOrion.includes(orion.organizationId)).toBe(true);
  });

  it('moves when the workspace writes and stays put when another workspace writes', async () => {
    const before = await bootstrapVersion(nova.admin);

    await createLabel(orion.admin, { name: 'Elsewhere', color: '#123456', teamId: null });
    expect(await bootstrapVersion(nova.admin)).toBe(before);

    await createLabel(nova.admin, { name: 'Here', color: '#654321', teamId: null });
    expect(await bootstrapVersion(nova.admin)).not.toBe(before);
  });
});
