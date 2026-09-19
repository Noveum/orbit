import { describe, expect, it } from 'bun:test';
import { issueExpectedPropertiesSchema, issueUpdateSchema } from '../../src/validators/index.ts';

describe('issue property undo preconditions', () => {
  it('accepts valid expected preconditions on issue updates', () => {
    const parsed = issueUpdateSchema.safeParse({
      stateId: 'state_done',
      expected: {
        stateId: 'state_in_progress',
        priority: 1,
        assigneeId: null,
        parentId: 'parent_1',
        labelIds: ['label_1', 'label_2'],
        reviewerIds: ['user_1'],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unexpected properties inside the expected block', () => {
    const parsed = issueUpdateSchema.safeParse({
      stateId: 'state_done',
      expected: {
        unknownField: 'invalid',
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('allows clearing nullable fields in expected preconditions', () => {
    const parsed = issueExpectedPropertiesSchema.parse({
      assigneeId: null,
      milestoneId: null,
      projectId: null,
      parentId: null,
    });
    expect(parsed.assigneeId).toBeNull();
    expect(parsed.milestoneId).toBeNull();
    expect(parsed.projectId).toBeNull();
    expect(parsed.parentId).toBeNull();
  });

  it('validates priority bounds within expected preconditions', () => {
    expect(
      issueExpectedPropertiesSchema.safeParse({
        priority: 0,
      }).success,
    ).toBe(true);
    expect(
      issueExpectedPropertiesSchema.safeParse({
        priority: 4,
      }).success,
    ).toBe(true);
    expect(
      issueExpectedPropertiesSchema.safeParse({
        priority: 5,
      }).success,
    ).toBe(false);
  });

  it('enforces bounds on label and reviewer expected arrays', () => {
    expect(
      issueExpectedPropertiesSchema.safeParse({
        labelIds: Array.from({ length: 51 }, (_, i) => `label_${i}`),
      }).success,
    ).toBe(false);
    expect(
      issueExpectedPropertiesSchema.safeParse({
        labelIds: ['label_1', 'label_2'],
        reviewerIds: ['user_1'],
      }).success,
    ).toBe(true);
  });
});
