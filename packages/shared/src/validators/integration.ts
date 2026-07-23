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
