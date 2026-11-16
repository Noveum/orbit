import { afterEach, expect, it, spyOn } from 'bun:test';
import dns from 'node:dns';
import { complete } from '@orbit/services/ai';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external.js';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import { createPatchedFetcher } from 'next/dist/server/lib/patch-fetch.js';
import { NEXT_PATCH_SYMBOL } from 'next/dist/server/lib/patch-fetch-symbol.js';

const originalFetch = globalThis.fetch;
const originalPatch = Reflect.get(globalThis, NEXT_PATCH_SYMBOL);
const originalAllowPrivate = process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPatch === undefined) Reflect.deleteProperty(globalThis, NEXT_PATCH_SYMBOL);
  else Reflect.set(globalThis, NEXT_PATCH_SYMBOL, originalPatch);
  if (originalAllowPrivate === undefined) delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
  else process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = originalAllowPrivate;
});

for (const kind of ['openai-compatible', 'anthropic'] as const) {
  it(`blocks private DNS destinations under Next patched fetch for ${kind}`, async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
    let outbound = 0;
    const origin = Object.assign(() => {
      outbound += 1;
      return Promise.resolve(Response.json({ choices: [], content: [] }));
    }, originalFetch);
    globalThis.fetch = createPatchedFetcher(origin, { workAsyncStorage, workUnitAsyncStorage });
    const lookup = spyOn(dns, 'lookup').mockImplementation(
      Object.assign((...args: Parameters<typeof dns.lookup>) => {
        const callback = args.at(-1);
        if (typeof callback === 'function') callback(null, '169.254.169.254', 4);
      }, dns.lookup),
    );
    try {
      let failure: unknown;
      try {
        await complete('probe', {
          config: { kind, baseUrl: 'https://provider.example/v1', model: 'test', enabled: true },
          apiKey: 'synthetic-provider-credential',
          recordUsage: false,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure instanceof Error ? failure.cause : undefined).toContain(
        'Blocked connection to private address',
      );
      expect(outbound).toBe(0);
      expect(lookup).toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });
}
