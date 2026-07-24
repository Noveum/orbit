import { z } from 'zod';
import { idSchema } from './common.ts';

export const githubLinkRepositorySchema = z.object({
  repositoryId: z.string().trim().min(1).max(64),
  repositoryName: z.string().trim().min(1).max(512),
  teamId: idSchema,
  installationId: z.string().trim().max(64).default(''),
  defaultBranch: z.string().trim().min(1).max(255).default('main'),
});
export type GithubLinkRepository = z.infer<typeof githubLinkRepositorySchema>;

export const githubUnlinkRepositorySchema = z.object({
  repositoryId: z.string().trim().min(1).max(64),
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
