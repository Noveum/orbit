import { describe, expect, it } from 'vitest';
import {
  cycleUpdateSchema,
  docUpdateSchema,
  issueCreateSchema,
  issueUpdateSchema,
  labelUpdateSchema,
  milestoneUpdateSchema,
  organizationUpdateSchema,
  projectUpdateSchema,
  teamUpdateSchema,
  viewUpdateSchema,
  workflowStateUpdateSchema,
} from './index.ts';

const updateSchemas = {
  issue: issueUpdateSchema,
  label: labelUpdateSchema,
  project: projectUpdateSchema,
  milestone: milestoneUpdateSchema,
  cycle: cycleUpdateSchema,
  doc: docUpdateSchema,
  view: viewUpdateSchema,
  team: teamUpdateSchema,
  workflowState: workflowStateUpdateSchema,
  organization: organizationUpdateSchema,
} as const;

describe('update schemas never invent values', () => {
  it('returns an empty object for an empty patch', () => {
    for (const [name, schema] of Object.entries(updateSchemas)) {
      expect({ name, value: schema.parse({}) }).toEqual({ name, value: {} });
    }
  });

  it('returns only the keys the caller supplied', () => {
    expect(issueUpdateSchema.parse({ stateId: 'state_1' })).toEqual({ stateId: 'state_1' });
    expect(labelUpdateSchema.parse({ name: 'Bug' })).toEqual({ name: 'Bug' });
    expect(projectUpdateSchema.parse({ name: 'Alpha' })).toEqual({ name: 'Alpha' });
    expect(docUpdateSchema.parse({ title: 'Runbook' })).toEqual({ title: 'Runbook' });
  });

  it('still accepts an explicit null so a field can be cleared', () => {
    expect(issueUpdateSchema.parse({ assigneeId: null })).toEqual({ assigneeId: null });
  });

  it('still validates the fields it is given', () => {
    expect(issueUpdateSchema.safeParse({ priority: 9 }).success).toBe(false);
    expect(issueUpdateSchema.safeParse({ title: '' }).success).toBe(false);
    expect(labelUpdateSchema.safeParse({ color: 'red' }).success).toBe(false);
  });
});

describe('create schemas still apply their defaults', () => {
  it('fills defaults the caller omitted', () => {
    const parsed = issueCreateSchema.parse({ teamId: 'team_1', title: 'Ship it' });
    expect(parsed.priority).toBe(0);
    expect(parsed.description).toBe('');
    expect(parsed.assigneeId).toBeNull();
    expect(parsed.labelIds).toEqual([]);
  });
});
