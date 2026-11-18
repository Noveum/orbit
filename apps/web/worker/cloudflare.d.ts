declare module 'cloudflare:workers' {
  import type { DurableObjectState } from '@cloudflare/workers-types/index.ts';

  export abstract class DurableObject<Bindings = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Bindings;
    constructor(ctx: DurableObjectState, env: Bindings);
  }

  export const env: Record<string, unknown>;
}

declare const WebSocketPair: typeof import('@cloudflare/workers-types/index.ts').WebSocketPair;
