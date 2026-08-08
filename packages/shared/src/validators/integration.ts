import { z } from 'zod';
import { idSchema } from './common.ts';

const githubInstallationIdSchema = z.string().trim().regex(/^\d+$/).max(32);
const githubRepositoryIdSchema = z.string().trim().regex(/^\d+$/).max(32);

export const githubLinkRepositorySchema = z.object({
  repositoryId: githubRepositoryIdSchema,
  projectId: idSchema.nullable().default(null),
});
export type GithubLinkRepository = z.infer<typeof githubLinkRepositorySchema>;

export const githubUnlinkRepositorySchema = z.object({
  repositoryId: githubRepositoryIdSchema,
  projectId: idSchema.optional(),
  scope: z.enum(['one', 'all']).default('one'),
});
export type GithubUnlinkRepository = z.infer<typeof githubUnlinkRepositorySchema>;

export const githubRemoveInstallationSchema = z.object({
  installationId: githubInstallationIdSchema,
});

export const githubInstallRequestSchema = z.object({
  setup_action: z.literal('request'),
});

export const githubCallbackSchema = z.object({
  installation_id: githubInstallationIdSchema,
  setup_action: z.enum(['install', 'update']).optional(),
  code: z.string().trim().min(1).max(255),
  state: z.string().trim().min(1).max(2048),
});
export type GithubCallback = z.infer<typeof githubCallbackSchema>;

export const githubInstallWithoutCodeSchema = z.object({
  installation_id: githubInstallationIdSchema,
  setup_action: z.enum(['install', 'update']),
  state: z.string().trim().min(1).max(2048),
});

export const githubMisroutedInstallSchema = z.object({
  installation_id: githubInstallationIdSchema,
  setup_action: z.enum(['install', 'update']),
});

export const gitLinksQuerySchema = z.object({ issueId: idSchema });

export const slackInstallSchema = z.object({
  botToken: z.string().trim().min(1).max(255),
});

export const slackConnectChannelSchema = z.object({
  channelId: z.string().trim().min(1).max(64),
  channelName: z.string().trim().min(1).max(255),
  teamId: idSchema.nullable().default(null),
});
export type SlackConnectChannel = z.infer<typeof slackConnectChannelSchema>;

export const slackDisconnectChannelSchema = z.object({
  channelId: z.string().trim().min(1).max(64),
});

export const slackUrlVerificationSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string().min(1).max(1024),
});

export const slackEventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  team_id: z.string().min(1).max(64),
  event: z.object({
    type: z.string().min(1).max(64),
    channel: z.string().max(64).optional(),
    message_ts: z.string().max(64).optional(),
    links: z
      .array(z.object({ url: z.string().max(2048), domain: z.string().max(255).optional() }))
      .max(20)
      .optional(),
  }),
});

export const slackEventSchema = z.discriminatedUnion('type', [
  slackUrlVerificationSchema,
  slackEventCallbackSchema,
]);
export type SlackEvent = z.infer<typeof slackEventSchema>;
