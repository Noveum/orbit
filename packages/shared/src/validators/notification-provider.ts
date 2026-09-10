import { z } from 'zod';

export const notificationTitleSchema = z
  .string()
  .trim()
  .min(1)
  .transform((title) =>
    title.length <= 255
      ? title
      : `${title
          .slice(0, 254)
          .replace(/[\uD800-\uDBFF]$/u, '')
          .trimEnd()}…`,
  );

export const notificationProviderPayloadSchema = z.object({
  title: notificationTitleSchema,
  body: z.string().max(100_000).default(''),
  bodyFormat: z.enum(['markdown', 'plain_text']).default('markdown'),
  url: z.string().min(1).max(2048),
  externalUrl: z.string().max(2048).nullable().optional(),
});

export const notificationEmailPayloadSchema = z.object({
  from: z.string().min(1).max(320),
  to: z.string().email().max(254),
  subject: notificationTitleSchema,
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
