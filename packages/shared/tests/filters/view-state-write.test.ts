import { describe, expect, it } from 'bun:test';
import {
  countConditions,
  defaultViewState,
  inCondition,
  readViewState,
  viewStateWriteSchema,
} from '../../src/filters/index.ts';
import { viewCreateSchema } from '../../src/validators/view.ts';

const URGENT = {
  kind: 'group' as const,
  combinator: 'and' as const,
  children: [inCondition('priority', ['1'])],
};

function messagesOf(result: ReturnType<typeof viewStateWriteSchema.safeParse>): string {
  return result.success ? '' : result.error.issues.map((issue) => issue.message).join(' ');
}

describe('saving a view whose filter is not the shape a view stores', () => {
  it('refuses the write rather than storing a filter with no conditions', () => {
    const result = viewStateWriteSchema.safeParse({ priority: ['urgent'], assignee: 'nobody' });

    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('priority');
  });

  it('refuses conditions hidden under a key a view does not store', () => {
    const result = viewStateWriteSchema.safeParse({
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [],
        conditions: [{ property: 'priority', operator: 'in', values: ['1'] }],
      },
    });

    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('conditions');
  });

  it('refuses conditions hidden below a nested group', () => {
    const result = viewStateWriteSchema.safeParse({
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [{ kind: 'group', combinator: 'or', children: [], rules: ['priority'] }],
      },
    });

    expect(result.success).toBe(false);
    expect(messagesOf(result)).toContain('rules');
  });

  it('refuses a filter sent as a string, which used to decode to nothing', () => {
    const result = viewStateWriteSchema.safeParse({ filter: JSON.stringify(URGENT) });

    expect(result.success).toBe(false);
  });

  it('refuses display options a view does not store', () => {
    const result = viewStateWriteSchema.safeParse({ display: { columns: ['title'] } });

    expect(result.success).toBe(false);
  });

  it('keeps every condition of a filter that is the right shape', () => {
    const parsed = viewStateWriteSchema.parse({ filter: URGENT, groupBy: 'assignee' });

    expect(countConditions(parsed.filter)).toBe(1);
    expect(parsed.groupBy).toBe('assignee');
  });

  it('still allows a view that deliberately filters nothing', () => {
    const parsed = viewStateWriteSchema.parse({ groupBy: 'assignee' });

    expect(countConditions(parsed.filter)).toBe(0);
  });

  it('guards the create payload the API and the MCP tools both parse', () => {
    const result = viewCreateSchema.safeParse({
      name: 'Urgent across all teams',
      filter: { priority: ['urgent'] },
    });

    expect(result.success).toBe(false);
  });
});

describe('reading a view whose stored state was written by an older client', () => {
  it('recovers settings that were stored as encoded JSON', () => {
    const encoded = JSON.stringify({ ...defaultViewState('list'), groupBy: 'label' });

    const stored = readViewState(encoded);

    expect(stored.readable).toBe(true);
    expect(stored.state.groupBy).toBe('label');
  });

  it('unwraps more than one layer of encoding', () => {
    const encoded = JSON.stringify(
      JSON.stringify({ ...defaultViewState('list'), groupBy: 'label' }),
    );

    expect(readViewState(encoded).state.groupBy).toBe('label');
  });

  it('reports that it could not read anything rather than pretending it did', () => {
    const stored = readViewState('whatever the old client wrote');

    expect(stored.readable).toBe(false);
    expect(stored.state).toEqual(defaultViewState('list'));
  });

  it('calls a state it did read readable', () => {
    expect(readViewState({ groupBy: 'label' }).readable).toBe(true);
  });
});
