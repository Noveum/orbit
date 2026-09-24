import { z } from 'zod';

const base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

export const aiCredentialEnvelopeSchema = z.object({
  version: z.literal(1),
  iv: base64UrlSchema.length(16),
  ciphertext: base64UrlSchema,
  tag: base64UrlSchema.length(22),
});
export type AiCredentialEnvelope = z.infer<typeof aiCredentialEnvelopeSchema>;

export const aiProviderKindSchema = z.enum(['openai-compatible', 'anthropic']);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

export function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    octets.push(n);
  }
  const [b0, b1, b2, b3] = octets;
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    return null;
  }
  return [b0, b1, b2, b3];
}

function isSpecialIpv4Range(b0: number, b1: number, b2: number): boolean {
  if (b0 === 192 && b1 === 0 && (b2 === 0 || b2 === 2)) return true;
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;
  return false;
}

export function isPrivateIpv4Octets(octets: readonly [number, number, number, number]): boolean {
  const [b0, b1, b2] = octets;
  if (b0 === 0 || b0 === 10 || b0 === 127 || b0 >= 224) return true;
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
  if (b0 === 169 && b1 === 254) return true;
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  if (b0 === 192 && b1 === 168) return true;
  return isSpecialIpv4Range(b0, b1, b2);
}

export function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (octets === null) return false;
  return isPrivateIpv4Octets(octets);
}

function parseHexSegments(parts: readonly string[]): number[] | null {
  const hex: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    hex.push(Number.parseInt(part, 16));
  }
  return hex;
}

function parseEmbeddedIpv4(suffix: string): number[] | null {
  if (!suffix.includes('.')) return null;
  const v4 = parseIpv4(suffix);
  if (v4 === null) return null;
  return [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
}

function expandIpv6Groups(
  leftHex: readonly number[],
  rightHex: readonly number[],
  v4Groups: readonly number[] | null,
  hasDoubleColon: boolean,
): number[] | null {
  const v4Count = v4Groups === null ? 0 : 2;
  const totalSegments = leftHex.length + rightHex.length + v4Count;
  if (!hasDoubleColon) {
    if (totalSegments !== 8) return null;
    return [...leftHex, ...(v4Groups ?? [])];
  }

  if (totalSegments > 7) return null;
  const zeros = new Array<number>(8 - totalSegments).fill(0);
  return [...leftHex, ...zeros, ...rightHex, ...(v4Groups ?? [])];
}

export function parseIpv6(ip: string): number[] | null {
  const clean = ip.toLowerCase();
  const lastColon = clean.lastIndexOf(':');
  if (lastColon === -1) return null;
  const suffix = clean.slice(lastColon + 1);
  const v4Groups = parseEmbeddedIpv4(suffix);
  if (suffix.includes('.') && v4Groups === null) return null;
  const v6Prefix = v4Groups === null ? clean : clean.slice(0, lastColon);

  const doubleColon = v6Prefix.indexOf('::');
  if (doubleColon !== -1 && v6Prefix.indexOf('::', doubleColon + 2) !== -1) {
    return null;
  }

  const leftSegment = doubleColon === -1 ? v6Prefix : v6Prefix.slice(0, doubleColon);
  const rightSegment = doubleColon === -1 ? '' : v6Prefix.slice(doubleColon + 2);

  const leftHex = parseHexSegments(leftSegment.length === 0 ? [] : leftSegment.split(':'));
  if (leftHex === null) return null;

  const rightHex = parseHexSegments(rightSegment.length === 0 ? [] : rightSegment.split(':'));
  if (rightHex === null) return null;

  return expandIpv6Groups(leftHex, rightHex, v4Groups, doubleColon !== -1);
}

function extractEmbeddedIpv4(gA: number, gB: number): [number, number, number, number] {
  return [(gA >> 8) & 0xff, gA & 0xff, (gB >> 8) & 0xff, gB & 0xff];
}

export function isPrivateIpv6Groups(groups: readonly number[]): boolean {
  if (groups.length !== 8) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (groups.every((g) => g === 0)) return true;
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return true;
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPrivateIpv4Octets(extractEmbeddedIpv4(g6, g7));
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return isPrivateIpv4Octets(extractEmbeddedIpv4(g6, g7));
  }
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIpv4Octets(extractEmbeddedIpv4(g6, g7));
  }
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x2002) {
    return isPrivateIpv4Octets(extractEmbeddedIpv4(g1, g2));
  }
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const groups = parseIpv6(ip);
  if (groups === null) return false;
  return isPrivateIpv6Groups(groups);
}

function stripTrailingDots(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 46) {
    end -= 1;
  }
  return text.slice(0, end);
}

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const normalized = stripTrailingDots(hostname.trim().toLowerCase());
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true;
  }

  const clean =
    normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized;

  if (isPrivateIpv4(clean)) return true;
  if (isPrivateIpv6(clean)) return true;

  return false;
}

function isValidProviderUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.search.length > 0 || url.hash.length > 0) return false;

    const allowPrivate = process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] === 'true';
    if (!allowPrivate && isPrivateOrLoopbackHost(url.hostname)) {
      return false;
    }

    if (url.protocol === 'http:') {
      return allowPrivate || isPrivateOrLoopbackHost(url.hostname);
    }

    return true;
  } catch {
    return false;
  }
}

export const aiBaseUrlSchema = z.string().trim().url().max(2048).refine(isValidProviderUrl, {
  message: 'Provider Base URL must be a valid, non-private HTTPS endpoint (unless local dev).',
});

export const aiProviderConfigSchema = z.object({
  kind: aiProviderKindSchema,
  baseUrl: aiBaseUrlSchema,
  model: z.string().trim().min(1).max(255),
  enabled: z.boolean().default(false),
});
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;

export const saveAiConfigSchema = z.object({
  kind: aiProviderKindSchema,
  baseUrl: aiBaseUrlSchema,
  model: z.string().trim().min(1).max(255),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  enabled: z.boolean().default(false),
});
export type SaveAiConfig = z.infer<typeof saveAiConfigSchema>;

export const testAiConnectionSchema = z.object({
  kind: aiProviderKindSchema,
  baseUrl: aiBaseUrlSchema,
  model: z.string().trim().min(1).max(255),
  apiKey: z.string().trim().min(1).max(4096).optional(),
});
export type TestAiConnection = z.infer<typeof testAiConnectionSchema>;

export const testAiConnectionResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type TestAiConnectionResponse = z.infer<typeof testAiConnectionResponseSchema>;

export const openAiCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().optional().nullable(),
          })
          .optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type OpenAiCompletionResponse = z.infer<typeof openAiCompletionResponseSchema>;

export const anthropicMessagesResponseSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type AnthropicMessagesResponse = z.infer<typeof anthropicMessagesResponseSchema>;

export const aiUsageRecordSchema = z.object({
  id: z.string(),
  model: z.string(),
  provider: z.string(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  createdAt: z.string(),
});
export type AiUsageRecord = z.infer<typeof aiUsageRecordSchema>;

export const aiUsageSummarySchema = z.object({
  totalCalls: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>;

export const aiSettingsViewSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  kind: aiProviderKindSchema.nullable(),
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  hasApiKey: z.boolean(),
  usage: aiUsageSummarySchema,
});
export type AiSettingsView = z.infer<typeof aiSettingsViewSchema>;
