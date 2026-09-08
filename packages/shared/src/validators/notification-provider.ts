import { z } from 'zod';

export const notificationProviderPayloadSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().max(100_000).default(''),
  url: z.string().min(1).max(2048),
  externalUrl: z.string().max(2048).nullable().optional(),
});

export const notificationEmailPayloadSchema = z.object({
  from: z.string().min(1).max(320),
  to: z.string().email().max(254),
  subject: z.string().min(1).max(255),
  text: z.string().min(1).max(120_000),
});

export const notificationResendResponseSchema = z.object({ id: z.string().min(1) });

export const notificationSlackNamespaceSchema = z.object({
  slackTeamId: z.string().min(1),
  slackAppId: z.string().min(1),
  credentialGeneration: z.number().int().nonnegative().default(0),
  notificationDeliveryState: z.enum(['active', 'draining']).default('active'),
  slackReauthorize: z.boolean().default(false),
  scopes: z.array(z.string()).default([]),
});
