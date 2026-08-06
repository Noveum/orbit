import { describe, expect, it } from 'bun:test';
import { GET } from '../../../../../../src/app/api/integrations/github/callback/route.ts';

const BASE = 'http://localhost:3000/api/integrations/github/callback';

describe('github callback', () => {
  it('redirects to an error when the state is missing', async () => {
    const response = await GET(new Request(`${BASE}?installation_id=42&setup_action=install`));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('github=error');
  });

  it('redirects to an error when the state signature is forged', async () => {
    const forged = `${Buffer.from(JSON.stringify({ org: 'x', user: 'y', provider: 'github', exp: Date.now() + 60_000, nonce: 'n' })).toString('base64url')}.deadbeef`;
    const response = await GET(
      new Request(`${BASE}?installation_id=42&state=${encodeURIComponent(forged)}`),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('github=error');
  });
});
