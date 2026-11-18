import { after } from 'next/server';
import { performDeferredWork } from './perform.ts';
import { type DeferredWork, deferredWorkKey } from './work.ts';

export type DurableWorkDispatcher = (work: DeferredWork) => Promise<void>;

export type DeferredWorkRunner = (work: DeferredWork) => Promise<void>;

let durableDispatcher: DurableWorkDispatcher | undefined;

export function registerDurableWork(dispatcher: DurableWorkDispatcher | undefined): void {
  durableDispatcher = dispatcher;
}

async function handedToDurableWork(work: DeferredWork): Promise<boolean> {
  if (durableDispatcher === undefined) return false;
  try {
    await durableDispatcher(work);
    return true;
  } catch (error: unknown) {
    console.error(
      `Could not hand ${deferredWorkKey(work)} to durable background work, running it with the request.`,
      error,
    );
    return false;
  }
}

export async function runDeferredWork(
  work: DeferredWork,
  perform: DeferredWorkRunner = performDeferredWork,
): Promise<void> {
  if (await handedToDurableWork(work)) return;
  try {
    await perform(work);
  } catch (error: unknown) {
    console.error(`Background work ${deferredWorkKey(work)} failed.`, error);
  }
}

export function deferWork(work: DeferredWork): void {
  after(() => runDeferredWork(work));
}
