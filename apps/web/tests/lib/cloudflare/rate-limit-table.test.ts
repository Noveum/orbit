import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { RateLimitTable, type SqlExecutor } from '../../../src/lib/cloudflare/rate-limit-table.ts';

function table(): RateLimitTable {
  const database = new Database(':memory:');
  const executor: SqlExecutor = {
    exec: (query, ...bindings) => {
      const rows = database
        .query<Record<string, unknown>, (string | number)[]>(query)
        .all(...bindings);
      return { toArray: () => rows };
    },
  };
  return new RateLimitTable(executor);
}

const RULE = { window: 60, max: 3 };
const START = 1_800_000_000_000;

describe('the Durable Object rate limit table', () => {
  it('allows requests up to the limit and refuses the next one', () => {
    const limits = table();
    const decisions = [0, 1, 2, 3].map((step) => limits.consume('ip:signin', RULE, START + step));
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions[3]?.retryAfter).toBe(60);
  });

  it('reports how long is left in the window', () => {
    const limits = table();
    for (let step = 0; step < 3; step += 1) limits.consume('ip:signin', RULE, START);
    expect(limits.consume('ip:signin', RULE, START + 45_500).retryAfter).toBe(15);
  });

  it('starts a fresh window once the old one has passed', () => {
    const limits = table();
    for (let step = 0; step < 4; step += 1) limits.consume('ip:signin', RULE, START);
    expect(limits.consume('ip:signin', RULE, START + 60_000)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(limits.get('ip:signin', START + 60_000)?.count).toBe(1);
  });

  it('counts each key on its own', () => {
    const limits = table();
    for (let step = 0; step < 4; step += 1) limits.consume('ip:a', RULE, START);
    expect(limits.consume('ip:b', RULE, START).allowed).toBe(true);
  });

  it('reads back what it stored and forgets it after the window', () => {
    const limits = table();
    limits.consume('ip:signin', RULE, START);
    expect(limits.get('ip:signin', START + 1)).toEqual({
      key: 'ip:signin',
      count: 1,
      lastRequest: START,
    });
    expect(limits.get('ip:signin', START + 60_000)).toBeNull();
    expect(limits.get('ip:unknown', START)).toBeNull();
  });

  it('keeps the window when a record is overwritten', () => {
    const limits = table();
    limits.consume('ip:signin', RULE, START);
    limits.set({ key: 'ip:signin', count: 3, lastRequest: START + 10 }, START + 10);
    expect(limits.consume('ip:signin', RULE, START + 20)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
    expect(limits.get('ip:signin', START + 60_000)).toBeNull();
  });

  it('gives a record written without a window one hour to live', () => {
    const limits = table();
    limits.set({ key: 'ip:signin', count: 2, lastRequest: START }, START);
    expect(limits.get('ip:signin', START + 3_599_999)?.count).toBe(2);
    expect(limits.get('ip:signin', START + 3_600_000)).toBeNull();
  });
});
