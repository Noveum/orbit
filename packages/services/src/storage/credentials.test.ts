import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createCredentialResolver } from './credentials.ts';

const realFetch = globalThis.fetch;
const realFile = Bun.file;

afterEach(() => {
  globalThis.fetch = realFetch;
  (Bun as { file: typeof Bun.file }).file = realFile;
});

function stsResponse(accessKeyId: string, expiration: string): string {
  return `<?xml version="1.0"?>
    <AssumeRoleWithWebIdentityResponse>
      <AssumeRoleWithWebIdentityResult>
        <Credentials>
          <AccessKeyId>${accessKeyId}</AccessKeyId>
          <SecretAccessKey>secret</SecretAccessKey>
          <SessionToken>token</SessionToken>
          <Expiration>${expiration}</Expiration>
        </Credentials>
      </AssumeRoleWithWebIdentityResult>
    </AssumeRoleWithWebIdentityResponse>`;
}

describe('createCredentialResolver', () => {
  it('returns the configured keys without calling sts', async () => {
    const resolve = createCredentialResolver(
      'us-east-1',
      { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      {},
    );
    expect(await resolve()).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 'secret' });
  });

  it('returns undefined when neither keys nor a web identity are present', async () => {
    const resolve = createCredentialResolver('us-east-1', {}, {});
    expect(await resolve()).toBeUndefined();
  });

  it('assumes the role through web identity and caches the result', async () => {
    (Bun as { file: typeof Bun.file }).file = (() => ({
      text: () => Promise.resolve('web-identity-token'),
    })) as unknown as typeof Bun.file;
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(
        new Response(stsResponse('ASIA', new Date(Date.now() + 3_600_000).toISOString()), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;

    const resolve = createCredentialResolver(
      'us-east-1',
      {},
      { AWS_ROLE_ARN: 'arn:aws:iam::1:role/orbit', AWS_WEB_IDENTITY_TOKEN_FILE: '/token' },
    );
    const first = await resolve();
    const second = await resolve();
    expect(first?.accessKeyId).toBe('ASIA');
    expect(first?.sessionToken).toBe('token');
    expect(second?.accessKeyId).toBe('ASIA');
    expect(calls).toBe(1);
  });

  it('refreshes when the cached credentials are about to expire', async () => {
    (Bun as { file: typeof Bun.file }).file = (() => ({
      text: () => Promise.resolve('web-identity-token'),
    })) as unknown as typeof Bun.file;
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(
        new Response(stsResponse(`KEY${calls}`, new Date(Date.now() + 60_000).toISOString()), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;

    const resolve = createCredentialResolver(
      'us-east-1',
      {},
      { AWS_ROLE_ARN: 'arn:aws:iam::1:role/orbit', AWS_WEB_IDENTITY_TOKEN_FILE: '/token' },
    );
    expect((await resolve())?.accessKeyId).toBe('KEY1');
    expect((await resolve())?.accessKeyId).toBe('KEY2');
    expect(calls).toBe(2);
  });
});
