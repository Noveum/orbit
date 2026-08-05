import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@/test/render.tsx';
import { useAutosave } from './use-autosave.ts';

const DELAY = 5;

describe('autosaving a draft', () => {
  it('saves once the typing settles, and reports it saved', async () => {
    const save = mock(async (_value: string) => undefined);
    const { rerender, result } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: DELAY }),
      { initialProps: { value: 'one' } },
    );

    rerender({ value: 'two' });
    expect(result.current.status).toBe('unsaved');

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(save.mock.calls[0]?.[0]).toBe('two');
  });

  it('stops trying when the draft cannot be saved, rather than firing on every keystroke', async () => {
    const save = mock(async (_value: string) => undefined);
    const canSave = (value: string) => value.length <= 3;
    const { rerender, result } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: DELAY, canSave }),
      { initialProps: { value: 'ok' } },
    );

    rerender({ value: 'far too long' });
    await waitFor(() => expect(result.current.status).toBe('blocked'));

    rerender({ value: 'even longer than before' });
    act(() => result.current.saveNow());
    await waitFor(() => expect(result.current.status).toBe('blocked'));
    expect(save).not.toHaveBeenCalled();
  });

  it('picks the draft back up as soon as it fits again', async () => {
    const save = mock(async (_value: string) => undefined);
    const canSave = (value: string) => value.length <= 3;
    const { rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: DELAY, canSave }),
      { initialProps: { value: 'ok' } },
    );

    rerender({ value: 'far too long' });
    await new Promise((resolve) => setTimeout(resolve, DELAY * 4));
    expect(save).not.toHaveBeenCalled();

    rerender({ value: 'fit' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toBe('fit');
  });

  it('reports a failed save rather than pretending it landed', async () => {
    const save = mock((_value: string) => Promise.reject(new Error('nope')));
    const { rerender, result } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: DELAY }),
      { initialProps: { value: 'one' } },
    );

    rerender({ value: 'two' });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('a save landing after the draft outgrew the limit', () => {
  it('keeps reporting blocked rather than claiming there is something saveable', async () => {
    let release: (() => void) | null = null;
    const save = mock(
      async (_value: string) =>
        await new Promise<undefined>((resolve) => {
          release = () => resolve(undefined);
        }),
    );
    const canSave = (value: string) => value.length <= 3;
    const { rerender, result } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: DELAY, canSave }),
      { initialProps: { value: 'ok' } },
    );

    rerender({ value: 'fit' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe('saving');

    rerender({ value: 'far too long' });
    await waitFor(() => expect(result.current.status).toBe('blocked'));

    act(() => release?.());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe('blocked');
  });
});
