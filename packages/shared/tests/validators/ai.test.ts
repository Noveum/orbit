import { afterEach, describe, expect, it } from 'bun:test';
import {
  aiBaseUrlSchema,
  isPrivateIpv4,
  isPrivateIpv6,
  isPrivateOrLoopbackHost,
  parseIpv4,
  parseIpv6,
} from '../../src/validators/ai.ts';

const originalAllowPrivate = process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

describe('AI endpoint IP parsing and private guard', () => {
  afterEach(() => {
    if (originalAllowPrivate === undefined) {
      delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
    } else {
      process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = originalAllowPrivate;
    }
  });

  it('parses valid and invalid IPv4 formats', () => {
    expect(parseIpv4('127.0.0.1')).toEqual([127, 0, 0, 1]);
    expect(parseIpv4('10.255.0.1')).toEqual([10, 255, 0, 1]);
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv4('127.0.0')).toBeNull();
    expect(parseIpv4('fc-ai.com')).toBeNull();
    expect(parseIpv4('01.02.03.04')).toBeNull();
  });

  it('identifies private, loopback, link-local, and reserved IPv4 addresses', () => {
    expect(isPrivateIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateIpv4('127.10.20.30')).toBe(true);
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.254')).toBe(true);
    expect(isPrivateIpv4('192.168.1.100')).toBe(true);
    expect(isPrivateIpv4('169.254.169.254')).toBe(true);
    expect(isPrivateIpv4('100.64.0.1')).toBe(true);
    expect(isPrivateIpv4('0.0.0.0')).toBe(true);
    expect(isPrivateIpv4('224.0.0.1')).toBe(true);
    expect(isPrivateIpv4('240.0.0.1')).toBe(true);
    expect(isPrivateIpv4('255.255.255.255')).toBe(true);
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('93.184.216.34')).toBe(false);
  });

  it('parses valid and invalid IPv6 formats', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('fc00::1')).toEqual([0xfc00, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('fc-ai.com')).toBeNull();
    expect(parseIpv6('fd-provider.org')).toBeNull();
    expect(parseIpv6('invalid::ipv6::address')).toBeNull();
  });

  it('identifies private, loopback, ULA, and IPv4-mapped IPv6 addresses', () => {
    expect(isPrivateIpv6('::1')).toBe(true);
    expect(isPrivateIpv6('::')).toBe(true);
    expect(isPrivateIpv6('fc00::1')).toBe(true);
    expect(isPrivateIpv6('fd12:3456::1')).toBe(true);
    expect(isPrivateIpv6('fe80::1')).toBe(true);
    expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIpv6('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateIpv6('fc-ai.com')).toBe(false);
  });

  it('accepts ordinary provider hostnames starting with fc or fd', () => {
    expect(isPrivateOrLoopbackHost('fc-ai.com')).toBe(false);
    expect(isPrivateOrLoopbackHost('fd-provider.org')).toBe(false);
    expect(isPrivateOrLoopbackHost('fc.example.internal')).toBe(true);
    expect(isPrivateOrLoopbackHost('api.openai.com')).toBe(false);
    expect(isPrivateOrLoopbackHost('api.anthropic.com')).toBe(false);
  });

  it('rejects localhost with trailing dot and local domain suffixes', () => {
    expect(isPrivateOrLoopbackHost('localhost.')).toBe(true);
    expect(isPrivateOrLoopbackHost('localhost.........')).toBe(true);
    expect(isPrivateOrLoopbackHost('localhost')).toBe(true);
    expect(isPrivateOrLoopbackHost('sub.localhost.')).toBe(true);
    expect(isPrivateOrLoopbackHost('model.local.')).toBe(true);
    expect(isPrivateOrLoopbackHost('cluster.internal.')).toBe(true);
  });

  it('rejects bracketed IPv4-mapped loopback addresses', () => {
    expect(isPrivateOrLoopbackHost('[::ffff:127.0.0.1]')).toBe(true);
    expect(isPrivateOrLoopbackHost('[::ffff:7f00:1]')).toBe(true);
    expect(isPrivateOrLoopbackHost('[::1]')).toBe(true);
    expect(isPrivateOrLoopbackHost('[fc00::1]')).toBe(true);
    expect(isPrivateOrLoopbackHost('[fe80::1]')).toBe(true);
  });

  it('validates baseUrl schema against private endpoints and allows ordinary fc/fd domains', () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    expect(aiBaseUrlSchema.safeParse('https://fc-ai.com/v1').success).toBe(true);
    expect(aiBaseUrlSchema.safeParse('https://fd-provider.org/v1').success).toBe(true);
    expect(aiBaseUrlSchema.safeParse('https://api.openai.com/v1').success).toBe(true);

    expect(aiBaseUrlSchema.safeParse('http://localhost.:8080/v1').success).toBe(false);
    expect(aiBaseUrlSchema.safeParse('https://localhost.:8080/v1').success).toBe(false);
    expect(aiBaseUrlSchema.safeParse('https://[::ffff:127.0.0.1]:8080/v1').success).toBe(false);
    expect(aiBaseUrlSchema.safeParse('http://[::ffff:127.0.0.1]:8080/v1').success).toBe(false);
    expect(aiBaseUrlSchema.safeParse('https://[fc00::1]/v1').success).toBe(false);
    expect(aiBaseUrlSchema.safeParse('https://[fd00::1]/v1').success).toBe(false);
    expect(aiBaseUrlSchema.safeParse('https://127.0.0.1:8080/v1').success).toBe(false);
    expect(aiBaseUrlSchema.safeParse('https://169.254.169.254/v1').success).toBe(false);
  });

  it('permits private endpoints when ALLOW_PRIVATE_AI_ENDPOINTS is enabled', () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    expect(aiBaseUrlSchema.safeParse('http://localhost:11434/v1').success).toBe(true);
    expect(aiBaseUrlSchema.safeParse('http://localhost.:11434/v1').success).toBe(true);
    expect(aiBaseUrlSchema.safeParse('http://127.0.0.1:11434/v1').success).toBe(true);
    expect(aiBaseUrlSchema.safeParse('http://[::ffff:127.0.0.1]:11434/v1').success).toBe(true);
    expect(aiBaseUrlSchema.safeParse('https://[fc00::1]:8443/v1').success).toBe(true);
  });
});
