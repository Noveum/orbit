import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import {
  createLabel,
  deleteLabel,
  getLabel,
  type LabelRow,
  listLabels,
  updateLabel,
} from '../../src/work/label-service.ts';

let nova: Workspace;
let orion: Workspace;
let novaLabel: LabelRow;
let orionLabel: LabelRow;

beforeEach(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');
  novaLabel = (await createLabel(nova.admin, { name: 'Regression', color: '#EF4444' })).label;
  orionLabel = (await createLabel(orion.admin, { name: 'Regression', color: '#22C55E' })).label;
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

async function labelById(workspace: Workspace, labelId: string): Promise<LabelRow | undefined> {
  return (await listLabels(workspace.admin)).find((row) => row.id === labelId);
}

describe('the label fixture puts a same named label in each workspace', () => {
  it('holds two workspaces whose Regression labels are different rows', () => {
    expect(nova.organizationId).not.toBe(orion.organizationId);
    expect(novaLabel.id).not.toBe(orionLabel.id);
    expect(novaLabel.name).toBe(orionLabel.name);
  });
});

describe('getLabel stops at the workspace boundary', () => {
  it('reads its own label and refuses the one next door', async () => {
    expect((await getLabel(nova.admin, novaLabel.id)).color).toBe('#EF4444');
    expect(await errorOf(() => getLabel(nova.admin, orionLabel.id))).toBe('not_found');
    expect(await errorOf(() => getLabel(orion.admin, novaLabel.id))).toBe('not_found');
  });
});

describe('updateLabel stops at the workspace boundary', () => {
  it('refuses to rename a label in another workspace and leaves it untouched', async () => {
    expect(await errorOf(() => updateLabel(nova.admin, orionLabel.id, { name: 'Stolen' }))).toBe(
      'not_found',
    );

    const survivor = await labelById(orion, orionLabel.id);
    expect(survivor?.name).toBe('Regression');
    expect(survivor?.color).toBe('#22C55E');
  });

  it('refuses to move a foreign label onto a team of the asking workspace', async () => {
    expect(
      await errorOf(() => updateLabel(nova.admin, orionLabel.id, { teamId: nova.teamId })),
    ).toBe('not_found');

    expect((await labelById(orion, orionLabel.id))?.teamId).toBeNull();
  });

  it('still renames a label the asking workspace owns', async () => {
    const renamed = await updateLabel(nova.admin, novaLabel.id, { name: 'Flake' });

    expect(renamed.label.name).toBe('Flake');
    expect((await labelById(nova, novaLabel.id))?.name).toBe('Flake');
    expect((await labelById(orion, orionLabel.id))?.name).toBe('Regression');
  });
});

describe('deleteLabel stops at the workspace boundary', () => {
  it('refuses to delete a label in another workspace and leaves the row behind', async () => {
    expect(await errorOf(() => deleteLabel(nova.admin, orionLabel.id))).toBe('not_found');

    expect(await labelById(orion, orionLabel.id)).toBeDefined();
  });

  it('still deletes a label the asking workspace owns, and only that one', async () => {
    const actions = await deleteLabel(nova.admin, novaLabel.id);

    expect(actions[0]?.action).toBe('delete');
    expect(await labelById(nova, novaLabel.id)).toBeUndefined();
    expect(await labelById(orion, orionLabel.id)).toBeDefined();
  });
});
