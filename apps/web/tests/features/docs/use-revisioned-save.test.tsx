import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useRevisionedSave } from '../../../src/features/docs/use-revisioned-save.ts';
import { ApiError } from '../../../src/lib/query/fetcher.ts';

type SaveResult = { doc: { revision: number } };

function staleError(revision: number) {
  return new ApiError(409, 'conflict', 'That doc changed since you opened it.', {
    reason: 'stale_revision',
    revision,
  });
}

function setup(handler: (value: string, baseRevision: number) => Promise<SaveResult>) {
  const bases: number[] = [];
  const { result } = renderHook(() =>
    useRevisionedSave<string, SaveResult>({
      save: (value, baseRevision) => {
        bases.push(baseRevision);
        return handler(value, baseRevision);
      },
      initialRevision: 1,
    }),
  );
  return { result, bases };
}

describe('useRevisionedSave', () => {
  it('sends the revision its draft was built on and advances it after the save', async () => {
    const { result, bases } = setup(async () => ({ doc: { revision: 2 } }));

    await act(async () => {
      await result.current.save('first edit');
    });
    await act(async () => {
      await result.current.save('second edit');
    });

    expect(bases).toEqual([1, 2]);
    expect(result.current.stale).toBe(false);
  });

  it('flags a stale save and keeps the flag until a revision is adopted', async () => {
    const { result, bases } = setup(() => Promise.reject(staleError(9)));

    await act(async () => {
      await expect(result.current.save('losing draft')).rejects.toMatchObject({
        code: 'conflict',
      });
    });
    expect(result.current.stale).toBe(true);

    act(() => result.current.adoptRevision(9));
    expect(result.current.stale).toBe(false);
    expect(bases).toEqual([1]);
  });

  it('retries against the adopted revision once the draft was rebuilt on it', async () => {
    let revision = 2;
    const { result, bases } = setup(async () => ({ doc: { revision } }));

    await act(async () => {
      await result.current.save('first edit');
    });
    act(() => result.current.adoptRevision(9));
    revision = 10;
    await act(async () => {
      await result.current.save('after loading their version');
    });

    expect(bases).toEqual([1, 9]);
    expect(result.current.stale).toBe(false);
  });

  it('keeps a failure that is not a stale revision from showing the conflict', async () => {
    const { result } = setup(() =>
      Promise.reject(new ApiError(422, 'validation_failed', 'That doc is too long.')),
    );

    await act(async () => {
      await expect(result.current.save('too long')).rejects.toMatchObject({
        code: 'validation_failed',
      });
    });

    expect(result.current.stale).toBe(false);
  });
});
