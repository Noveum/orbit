import { describe, expect, it } from 'bun:test';
import {
  candidatesFor,
  HANDLE_CANDIDATES,
  handleBaseFor,
  uniqueHandleFor,
} from '../../../src/lib/auth/handle.ts';

function nothingTaken(): Promise<Set<string>> {
  return Promise.resolve(new Set<string>());
}

function alreadyTaken(...handles: string[]): () => Promise<Set<string>> {
  return () => Promise.resolve(new Set(handles));
}

describe('handleBaseFor', () => {
  it('prefers the name', () => {
    expect(handleBaseFor('hey@yodu.ai', 'Yodu AI')).toBe('yodu-ai');
  });

  it('falls back to the email local part when there is no name', () => {
    expect(handleBaseFor('hey@yodu.ai', '')).toBe('hey');
  });

  it('falls back to member when neither slugifies', () => {
    expect(handleBaseFor('!!!@example.com', '???')).toBe('member');
  });
});

describe('uniqueHandleFor', () => {
  it('gives a clean handle when nothing is taken', async () => {
    expect(await uniqueHandleFor('hey@yodu.ai', 'Yodu AI', nothingTaken)).toBe('yodu-ai');
  });

  it('does not append a suffix to the first person with a name', async () => {
    const handle = await uniqueHandleFor('ada@example.com', 'Ada Lovelace', nothingTaken);
    expect(handle).toBe('ada-lovelace');
    expect(handle).not.toMatch(/-[0-9a-f]{10}$/);
  });

  it('numbers the second person with the same name', async () => {
    expect(
      await uniqueHandleFor('ada2@example.com', 'Ada Lovelace', alreadyTaken('ada-lovelace')),
    ).toBe('ada-lovelace-2');
  });

  it('keeps counting past the first collision', async () => {
    const taken = alreadyTaken('ada-lovelace', 'ada-lovelace-2', 'ada-lovelace-3');
    expect(await uniqueHandleFor('ada4@example.com', 'Ada Lovelace', taken)).toBe('ada-lovelace-4');
  });

  it('falls back to a random suffix when every numbered candidate is taken', async () => {
    const crowded = Array.from({ length: 40 }, (_, index) =>
      index === 0 ? 'ada-lovelace' : `ada-lovelace-${index + 1}`,
    );
    const handle = await uniqueHandleFor(
      'ada@example.com',
      'Ada Lovelace',
      alreadyTaken(...crowded),
    );
    expect(handle).toMatch(/^ada-lovelace-[0-9a-f]{10}$/);
  });

  it('asks about every candidate in one call', async () => {
    const calls: string[][] = [];
    await uniqueHandleFor('ada@example.com', 'Ada Lovelace', (candidates) => {
      calls.push([...candidates]);
      return Promise.resolve(new Set<string>());
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('ada-lovelace');
    expect(calls[0]?.[1]).toBe('ada-lovelace-2');
  });
});

describe('candidate set', () => {
  it('is HANDLE_CANDIDATES entries: the base plus numbered variants', () => {
    const candidates = candidatesFor('ada-lovelace');
    expect(candidates).toHaveLength(HANDLE_CANDIDATES);
    expect(candidates[0]).toBe('ada-lovelace');
    expect(candidates[1]).toBe('ada-lovelace-2');
    expect(candidates.at(-1)).toBe(`ada-lovelace-${HANDLE_CANDIDATES}`);
  });

  it('falls back to a random suffix only once every candidate is taken', async () => {
    const candidates = candidatesFor('ada-lovelace');
    const handle = await uniqueHandleFor(
      'ada@example.com',
      'Ada Lovelace',
      async () => new Set(candidates),
    );
    expect(candidates).not.toContain(handle);
    expect(handle).toMatch(/^ada-lovelace-[0-9a-f]{10}$/);
  });
});
