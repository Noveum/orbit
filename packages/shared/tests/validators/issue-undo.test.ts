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
    });
    expect(parsed.assigneeId).toBeNull();
    expect(parsed.milestoneId).toBeNull();
    expect(parsed.projectId).toBeNull();
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
});
