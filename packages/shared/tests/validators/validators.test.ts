import { describe, expect, it } from 'bun:test';
import {
  bootstrapQuerySchema,
  cycleCreateSchema,
  cycleUpdateSchema,
  docFilterSchema,
  docUpdateSchema,
  issueCreateSchema,
  issueFilterSchema,
  issueUpdateSchema,
  labelUpdateSchema,
  milestoneUpdateSchema,
  organizationUpdateSchema,
  projectUpdateSchema,
  teamUpdateSchema,
  viewUpdateSchema,
  workflowStateUpdateSchema,
} from '../../src/validators/index.ts';

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

describe('validator hardening from review', () => {
  it('rejects a null or blank cycle date instead of coercing it to the epoch', () => {
    expect(
      cycleCreateSchema.safeParse({ teamId: 'team_1', startsAt: null, endsAt: '2026-01-02' })
        .success,
    ).toBe(false);
    expect(
      cycleCreateSchema.safeParse({ teamId: 'team_1', startsAt: '   ', endsAt: '2026-01-02' })
        .success,
    ).toBe(false);
  });

  it('treats includeArchived=false as false', () => {
    expect(docFilterSchema.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(docFilterSchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    expect(docFilterSchema.parse({}).includeArchived).toBe(false);
  });

  it('rejects a malformed boolean query value rather than reading it as false', () => {
    expect(issueFilterSchema.safeParse({ includeArchived: 'unexpected' }).success).toBe(false);
    expect(issueFilterSchema.parse({ includeArchived: '0' }).includeArchived).toBe(false);
  });

  it('rejects a blank team selector and a blank allowed email domain', () => {
    expect(bootstrapQuerySchema.safeParse({ team: '   ' }).success).toBe(false);
    expect(organizationUpdateSchema.safeParse({ allowedEmailDomains: ['   '] }).success).toBe(
      false,
    );
  });
});

describe('calendar dates', () => {
  const dayOf = (value: unknown): string | null => {
    const parsed = issueUpdateSchema.safeParse({ dueDate: value });
    if (!parsed.success) return null;
    const day = parsed.data.dueDate;
    return day === null || day === undefined ? null : day.toISOString().slice(0, 10);
  };

  it('reads a calendar day as that day in UTC, whatever the host timezone is', () => {
    expect(dayOf('2031-03-04')).toBe('2031-03-04');
    expect(dayOf('0001-01-01')).toBe('0001-01-01');
    expect(dayOf('9999-12-31')).toBe('9999-12-31');
  });

  it('refuses a year a date column cannot hold, rather than truncating it', () => {
    for (const extreme of ['+275760-09-13', '-000001-01-01', '0000-12-31', '10000-01-01']) {
      expect({ sent: extreme, day: dayOf(extreme) }).toEqual({ sent: extreme, day: null });
    }
  });

  it('fails the parse on such a year instead of quietly storing no date', () => {
    for (const extreme of ['+275760-09-13', '-000001-01-01', '0000-12-31', '10000-01-01']) {
      const parsed = issueUpdateSchema.safeParse({ dueDate: extreme });

      expect({ sent: extreme, accepted: parsed.success }).toEqual({
        sent: extreme,
        accepted: false,
      });
    }
  });

  it('refuses anything that is not a calendar day', () => {
    for (const nonsense of [
      true,
      false,
      0,
      1_700_000_000_000,
      'banana',
      '2026-02-30',
      '2026-2-3',
      '',
      {},
      [],
    ]) {
      expect(issueUpdateSchema.safeParse({ dueDate: nonsense }).success).toBe(false);
    }
  });

  it('keeps null, which is how a due date is cleared', () => {
    expect(issueUpdateSchema.parse({ dueDate: null }).dueDate).toBeNull();
  });

  it('holds project and milestone dates to the same shape', () => {
    expect(projectUpdateSchema.safeParse({ targetDate: '+275760-09-13' }).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ startDate: true }).success).toBe(false);
    expect(milestoneUpdateSchema.safeParse({ targetDate: '10000-01-01' }).success).toBe(false);
    expect(milestoneUpdateSchema.safeParse({ targetDate: '2031-03-01' }).success).toBe(true);
  });
});
