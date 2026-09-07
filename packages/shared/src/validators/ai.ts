import { z } from 'zod';

export const aiProviderKindSchema = z.enum(['openai-compatible', 'anthropic']);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

export const aiProviderConfigSchema = z.object({
  kind: aiProviderKindSchema,
  baseUrl: z.string().trim().url().max(2048),
  model: z.string().trim().min(1).max(255),
  enabled: z.boolean().default(true),
});
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;

export const saveAiConfigSchema = z.object({
  kind: aiProviderKindSchema,
  baseUrl: z.string().trim().url().max(2048),
  model: z.string().trim().min(1).max(255),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  enabled: z.boolean().default(true),
});
export type SaveAiConfig = z.infer<typeof saveAiConfigSchema>;

export const testAiConnectionSchema = z.object({
  kind: aiProviderKindSchema,
  baseUrl: z.string().trim().url().max(2048),
  model: z.string().trim().min(1).max(255),
  apiKey: z.string().trim().min(1).max(4096).optional(),
});
export type TestAiConnection = z.infer<typeof testAiConnectionSchema>;

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
