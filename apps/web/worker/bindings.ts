import { env } from 'cloudflare:workers';
import type {
  DurableObjectNamespace,
  DurableObjectStub,
  Fetcher,
  Hyperdrive,
} from '@cloudflare/workers-types/index.ts';

export interface WorkerBindings {
  readonly ASSETS: Fetcher;
  readonly REALTIME_HUB: DurableObjectNamespace;
  readonly AUTH_RATE_LIMITER: DurableObjectNamespace;
  readonly DEFERRED_WORK: DurableObjectNamespace;
  readonly HYPERDRIVE?: Hyperdrive;
}

const SINGLETON = 'global';

export function bindings(): WorkerBindings {
  return env as unknown as WorkerBindings;
}

export function realtimeHub(): DurableObjectStub {
  const namespace = bindings().REALTIME_HUB;
  return namespace.get(namespace.idFromName(SINGLETON));
}

export function authRateLimiter(): DurableObjectStub {
  const namespace = bindings().AUTH_RATE_LIMITER;
  return namespace.get(namespace.idFromName(SINGLETON));
}

export function deferredWork(key: string): DurableObjectStub {
  const namespace = bindings().DEFERRED_WORK;
  return namespace.get(namespace.idFromName(key));
}
