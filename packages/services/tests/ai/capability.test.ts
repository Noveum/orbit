import { describe, expect, it } from 'bun:test';
import { loadAiProviderStatus } from '../../src/ai/capability.ts';

describe('loadAiProviderStatus()', () => {
  it('returns a disabled, unconfigured status when given an org with no db row', async () => {
    const status = await loadAiProviderStatus('org_nonexistent');
    expect(status).toEqual({
      configured: false,
      enabled: false,
      kind: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
    });
  });
});
