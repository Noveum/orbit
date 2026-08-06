import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@/test/render.tsx';
import { useAutosave } from '../../../src/features/docs/use-autosave.ts';

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

describe('leaving the page with a draft still in the debounce', () => {
  it('saves it on the way out rather than waiting for a timer that will never fire', async () => {
    const save = mock(async (_value: string) => undefined);
    const { rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 100_000 }),
      { initialProps: { value: 'one' } },
    );

    rerender({ value: 'two' });
    expect(save).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toBe('two');
  });

  it('saves when the tab is hidden, which is where a phone goes', async () => {
    const save = mock(async (_value: string) => undefined);
    const { rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 100_000 }),
      { initialProps: { value: 'one' } },
    );

    rerender({ value: 'two' });
    const seen = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });

    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
      if (seen !== undefined) Object.defineProperty(Document.prototype, 'visibilityState', seen);
    }
  });
});

describe('two flushes arriving while a save is already running', () => {
  it('sends one request, then one more for whatever changed meanwhile', async () => {
    const seen: string[] = [];
    let release: (() => void) | null = null;
    const save = mock((value: string) => {
      seen.push(value);
      return new Promise<undefined>((resolve) => {
        release = () => resolve(undefined);
      });
    });

    const { rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 5 }),
      { initialProps: { value: 'one' } },
    );

    rerender({ value: 'two' });
    await waitFor(() => expect(seen).toEqual(['two']));

    rerender({ value: 'three' });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(seen).toEqual(['two']);

    act(() => release?.());
    await waitFor(() => expect(seen).toEqual(['two', 'three']));
  });
});
