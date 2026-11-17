import { describe, expect, it } from 'bun:test';
import { withEdgeClientAddress } from '../../../src/lib/cloudflare/client-address.ts';

describe('the client address a Worker request carries', () => {
  it('replaces a forwarded address the client supplied with the one the edge saw', () => {
    const request = withEdgeClientAddress(
      new Request('https://orbit.example/api/auth/sign-in/email', {
        method: 'POST',
        body: '{}',
        headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7', 'cf-connecting-ip': '203.0.113.9' },
      }),
    );
    expect(request.headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://orbit.example/api/auth/sign-in/email');
  });

  it('drops a forwarded address when the edge reports none', () => {
    const request = withEdgeClientAddress(
      new Request('https://orbit.example/', { headers: { 'x-forwarded-for': '6.6.6.6' } }),
    );
    expect(request.headers.has('x-forwarded-for')).toBe(false);
  });

  it('keeps the body readable', async () => {
    const request = withEdgeClientAddress(
      new Request('https://orbit.example/', { method: 'POST', body: 'payload' }),
    );
    expect(await request.text()).toBe('payload');
  });
});
