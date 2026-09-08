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

function isValidProviderUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') {
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    }
    return false;
  } catch {
    return false;
  }
}

export const aiBaseUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(isValidProviderUrl, { message: 'Provider Base URL must use HTTPS (unless localhost).' });

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
