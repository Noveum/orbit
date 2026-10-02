import { describe, expect, it } from 'bun:test';
import {
  actorRefSchema,
  agentIdentityProfileSchema,
  agentIdentitySelectionSchema,
  idempotencyKeySchema,
  mcpCodeChallengeSchema,
  mcpCodeVerifierSchema,
  mcpConsentDecisionSchema,
  mcpConsentRequestValueSchema,
  mcpGrantQuerySchema,
  mcpTokenRequestSchema,
} from '../../src/validators/agent-identity.ts';

describe('agent identity validators', () => {
  it('accepts only strict Orbit-hosted identity profiles', () => {
    expect(
      agentIdentityProfileSchema.parse({
        name: '  Researcher  ',
        avatar: '/api/avatars/agent-1?v=1',
      }),
    ).toEqual({ name: 'Researcher', avatar: '/api/avatars/agent-1?v=1' });
    expect(
      agentIdentityProfileSchema.safeParse({ name: 'Researcher', avatar: '/api/avatars/missing' })
        .success,
    ).toBe(false);
    expect(
      agentIdentityProfileSchema.safeParse({
        name: 'Researcher',
        avatar: 'https://tracker.example/a',
      }).success,
    ).toBe(false);
    expect(
      agentIdentityProfileSchema.safeParse({
        name: 'Researcher',
        avatar: null,
        scope: 'orbit.read',
      }).success,
    ).toBe(false);
  });

  it('makes selecting and creating an identity mutually exclusive', () => {
    expect(
      agentIdentitySelectionSchema.safeParse({
        agentIdentityId: 'agent-1',
        replaceActiveGrant: false,
        createAgent: { name: 'Researcher', avatar: null },
      }).success,
    ).toBe(false);
    expect(
      agentIdentitySelectionSchema.parse({ createAgent: { name: 'Researcher', avatar: null } }),
    ).toEqual({ createAgent: { name: 'Researcher', avatar: null } });
  });

  it('keeps actor refs typed and idempotency keys bounded', () => {
    expect(actorRefSchema.parse({ type: 'agent', id: 'agent-1' })).toEqual({
      type: 'agent',
      id: 'agent-1',
    });
    expect(
      actorRefSchema.safeParse({ type: 'agent', id: 'agent-1', name: 'Researcher' }).success,
    ).toBe(false);
    expect(idempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('shares strict MCP consent and grant request contracts', () => {
    expect(
      mcpConsentDecisionSchema.parse({
        decision: 'allow',
        consentCode: 'consent-1',
        organizationId: 'org-1',
        identitySelection: { agentIdentityId: 'agent-1', replaceActiveGrant: false },
      }),
    ).toEqual({
      decision: 'allow',
      consentCode: 'consent-1',
      organizationId: 'org-1',
      identitySelection: { agentIdentityId: 'agent-1', replaceActiveGrant: false },
    });
    expect(
      mcpConsentRequestValueSchema.parse({
        clientId: 'client-1',
        redirectURI: 'https://client.example/callback',
        scope: ['orbit.read'],
        userId: 'user-1',
        requireConsent: true,
        codeChallenge: 'pkce-challenge',
        codeChallengeMethod: 'S256',
      }).codeChallenge,
    ).toBe('pkce-challenge');
    expect(
      mcpConsentRequestValueSchema.safeParse({
        clientId: '',
        redirectURI: 'https://client.example/callback',
        scope: ['orbit.read'],
        userId: 'user-1',
      }).success,
    ).toBe(false);
    expect(mcpGrantQuerySchema.safeParse({ grantId: '' }).success).toBe(false);
    expect(mcpGrantQuerySchema.safeParse({ grantId: 'grant-1', userId: 'user-1' }).success).toBe(
      false,
    );
  });

  it('shares OAuth token and PKCE input validation with the route', () => {
    expect(mcpCodeChallengeSchema.safeParse('a'.repeat(43)).success).toBe(true);
    expect(mcpCodeChallengeSchema.safeParse('a'.repeat(42)).success).toBe(false);
    expect(mcpCodeVerifierSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(mcpCodeVerifierSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(
      mcpTokenRequestSchema.safeParse({ grant_type: 'authorization_code', code: 'abc' }).success,
    ).toBe(true);
    expect(
      mcpTokenRequestSchema.safeParse({ grant_type: 'authorization_code', code: 12 }).success,
    ).toBe(false);
  });
});
