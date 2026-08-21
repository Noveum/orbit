import { z } from 'zod';

const labelSchema = z.object({
  name: z.string(),
});

export const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string().url(),
  body: z.string().nullable(),
  labels: z.array(labelSchema),
  merged_at: z.string().nullable(),
  base: z.object({
    ref: z.string(),
  }),
});

export const pullRequestListSchema = z.array(pullRequestSchema);

export const githubCommitSchema = z.object({
  sha: z.string().min(1),
});

export const commitPageSchema = z.array(githubCommitSchema);

export const releaseSchema = z.object({
  tag_name: z.string().min(1),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
});

export const releaseListSchema = z.array(releaseSchema);

export type PullRequest = z.infer<typeof pullRequestSchema>;
export type GitHubCommit = z.infer<typeof githubCommitSchema>;
export type GitHubRelease = z.infer<typeof releaseSchema>;
