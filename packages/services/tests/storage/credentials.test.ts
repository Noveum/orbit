import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentialResolver } from '../../src/storage/credentials.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function tokenFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-web-identity-'));
  const path = join(directory, 'token');
  await writeFile(path, 'web-identity-token', 'utf8');
  return path;
}

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
    const token = await tokenFile();
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
      { AWS_ROLE_ARN: 'arn:aws:iam::1:role/orbit', AWS_WEB_IDENTITY_TOKEN_FILE: token },
    );
    const first = await resolve();
    const second = await resolve();
    expect(first?.accessKeyId).toBe('ASIA');
    expect(first?.sessionToken).toBe('token');
    expect(second?.accessKeyId).toBe('ASIA');
    expect(calls).toBe(1);
  });

  it('refreshes when the cached credentials are about to expire', async () => {
    const token = await tokenFile();
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
      { AWS_ROLE_ARN: 'arn:aws:iam::1:role/orbit', AWS_WEB_IDENTITY_TOKEN_FILE: token },
    );
    expect((await resolve())?.accessKeyId).toBe('KEY1');
    expect((await resolve())?.accessKeyId).toBe('KEY2');
    expect(calls).toBe(2);
  });

  it('keeps serving still-valid credentials when a refresh fails', async () => {
    const token = await tokenFile();
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response(stsResponse('ASIA', new Date(Date.now() + 60_000).toISOString()), {
            status: 200,
          }),
        );
      }
      return Promise.reject(new Error('sts unavailable'));
    }) as unknown as typeof fetch;

    const resolve = createCredentialResolver(
      'us-east-1',
      {},
      { AWS_ROLE_ARN: 'arn:aws:iam::1:role/orbit', AWS_WEB_IDENTITY_TOKEN_FILE: token },
    );
    expect((await resolve())?.accessKeyId).toBe('ASIA');
    expect((await resolve())?.accessKeyId).toBe('ASIA');
    expect(calls).toBe(2);
  });
});
