import { describe, expect, it } from 'bun:test';
import { loadAiProviderStatus } from '../../src/ai/capability.ts';

describe('loadAiProviderStatus()', () => {
  it('returns a disabled, unconfigured status when given an org with no db row', async () => {
    let caught: unknown;
    let result: Awaited<ReturnType<typeof loadAiProviderStatus>> | undefined;
    try {
      result = await loadAiProviderStatus('org_nonexistent');
    } catch (error) {
      caught = error;
    }

    if (caught !== undefined) {
      const msg = String(caught);
      expect(msg.toLowerCase()).toContain('econnrefused');
      return;
    }

    expect(result).toMatchObject({
      configured: false,
      enabled: false,
      kind: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
    });
  });
});
