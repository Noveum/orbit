import { afterEach, describe, expect, it } from 'bun:test';
import {
  aiBaseUrlSchema,
  anthropicMessagesResponseSchema,
  isPrivateIpv4,
  isPrivateIpv6,
  isPrivateOrLoopbackHost,
  parseIpv4,
  parseIpv6,
} from '../../src/validators/ai.ts';

const originalAllowPrivate = process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

describe('AI endpoint IP parsing and private guard', () => {
  it('rejects endpoint credentials that the checked transport does not send', () => {
    for (const endpoint of [
      'https://user:password@provider.example/v1',
      'https://user@provider.example/v1',
    ]) {
      expect(aiBaseUrlSchema.safeParse(endpoint).success).toBe(false);
    }
  });

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

  it('preserves compression before an embedded IPv4 suffix', () => {
    expect(parseIpv6('::127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0, 0x7f00, 1]);
    expect(parseIpv6('2001:db8::192.0.2.1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0xc000, 0x0201]);
    expect(parseIpv6(':::127.0.0.1')).toBeNull();
  });

  it('classifies IPv4-compatible IPv6 using its embedded destination', () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
    for (const address of [
      '::127.0.0.1',
      '::7f00:1',
      '::10.0.0.1',
      '::192.168.1.1',
      '::169.254.169.254',
    ]) {
      expect(isPrivateIpv6(address)).toBe(true);
      expect(isPrivateOrLoopbackHost(`[${address}]`)).toBe(true);
      expect(aiBaseUrlSchema.safeParse(`https://[${address}]/v1`).success).toBe(false);
    }
    expect(isPrivateIpv6('::8.8.8.8')).toBe(false);
    expect(isPrivateIpv6('::808:808')).toBe(false);
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

  it('rejects the whole local-use translation prefix in provider URLs', () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
    for (const address of [
      '64:ff9b:1::',
      '64:ff9b:1::a00:1',
      '64:ff9b:1:1234:5678:9abc:def0:1234',
      '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
    ]) {
      expect(aiBaseUrlSchema.safeParse(`https://[${address}]/v1`).success).toBe(false);
      expect(isPrivateIpv6(address)).toBe(true);
    }
    expect(aiBaseUrlSchema.safeParse('https://[64:ff9b::808:808]/v1').success).toBe(true);
    expect(isPrivateIpv6('64:ff9b:2::')).toBe(false);
  });

  it('permits local-use translation URLs only with the explicit private override', () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';
    expect(aiBaseUrlSchema.safeParse('https://[64:ff9b:1::a00:1]/v1').success).toBe(true);
    expect(
      aiBaseUrlSchema.safeParse('https://[64:ff9b:1:1234:5678:9abc:def0:1234]/v1').success,
    ).toBe(true);
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

describe('Anthropic completion content validation', () => {
  for (const text of [undefined, null, 42]) {
    it(`rejects an invalid text value: ${String(text)}`, () => {
      const block = text === undefined ? { type: 'text' } : { type: 'text', text };
      expect(anthropicMessagesResponseSchema.safeParse({ content: [block] }).success).toBe(false);
    });
  }

  for (const text of ['', 'completion']) {
    it(`accepts an explicit string text value: ${JSON.stringify(text)}`, () => {
      expect(
        anthropicMessagesResponseSchema.safeParse({ content: [{ type: 'text', text }] }).success,
      ).toBe(true);
    });
  }

  for (const block of [
    { type: 'thinking', thinking: 'fixture', signature: 'fixture-signature' },
    { type: 'tool_use', id: 'toolu_fixture', name: 'fixture_tool', input: {} },
  ]) {
    it(`accepts a valid non-text block: ${block.type}`, () => {
      expect(anthropicMessagesResponseSchema.safeParse({ content: [block] }).success).toBe(true);
    });
  }
});
