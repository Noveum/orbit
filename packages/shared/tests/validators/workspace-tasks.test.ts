import { describe, expect, it } from 'bun:test';
import { workspaceTaskSchema } from '../../src/validators/workspace-tasks.ts';

const taskPrioritySchema = workspaceTaskSchema.pick({ priority: true });

describe('workspace task response priorities', () => {
  it('accepts every supported priority', () => {
    for (const priority of [0, 1, 2, 3, 4]) {
      expect(taskPrioritySchema.safeParse({ priority }).success).toBe(true);
    }
  });
  it('rejects unsupported priority values instead of presenting them as none', () => {
    for (const priority of [-1, 5, 1.5, Number.NaN]) {
      expect(taskPrioritySchema.safeParse({ priority }).success).toBe(false);
    }
  });
});
