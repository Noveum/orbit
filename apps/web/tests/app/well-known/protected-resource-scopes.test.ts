import { describe, expect, it } from 'bun:test';
import { withOrbitScopes } from '../../../src/app/.well-known/oauth-protected-resource/route.ts';
import { MCP_SCOPES } from '../../../src/lib/auth/server.ts';

describe('the protected resource metadata', () => {
  it('advertises every scope the authorization server issues', () => {
    const metadata = withOrbitScopes({
      resource: 'https://orbit.noveum.ai/mcp',
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    });

    expect(metadata['scopes_supported']).toEqual([...MCP_SCOPES]);
  });

  it('names the scopes the tools actually require, which is what a client asks for', () => {
    const advertised = withOrbitScopes({})['scopes_supported'];

    expect(advertised).toContain('orbit.read');
    expect(advertised).toContain('orbit.write');
  });

  it('leaves the rest of the document alone', () => {
    const metadata = withOrbitScopes({
      resource: 'https://orbit.noveum.ai/mcp',
      authorization_servers: ['https://orbit.noveum.ai'],
      jwks_uri: 'https://orbit.noveum.ai/api/auth/mcp/jwks',
    });

    expect(metadata['resource']).toBe('https://orbit.noveum.ai/mcp');
    expect(metadata['authorization_servers']).toEqual(['https://orbit.noveum.ai']);
    expect(metadata['jwks_uri']).toBe('https://orbit.noveum.ai/api/auth/mcp/jwks');
  });
});
