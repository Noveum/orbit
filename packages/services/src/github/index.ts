import { createHmac, timingSafeEqual } from 'node:crypto';
import { type NotificationType, STATE_CATEGORY_ORDER, type StateCategory } from '@orbit/shared';
import { z } from 'zod';

export * from './apply.ts';

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (secret.length === 0 || signatureHeader === null) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = Buffer.from(`sha256=${digest}`, 'utf8');
  const received = Buffer.from(signatureHeader, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export const PULL_REQUEST_STATES = [
  'draft',
  'open',
  'approved',
  'changes_requested',
  'merged',
  'closed',
] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export type ReviewDecision = 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export function pullRequestState(input: {
  readonly draft: boolean;
  readonly merged: boolean;
  readonly closed: boolean;
  readonly review?: ReviewDecision | null;
}): PullRequestState {
  if (input.merged) return 'merged';
  if (input.closed) return 'closed';
  if (input.draft) return 'draft';
  if (input.review === 'approved') return 'approved';
  if (input.review === 'changes_requested') return 'changes_requested';
  return 'open';
}

const CATEGORY_FOR_STATE: Record<PullRequestState, StateCategory | null> = {
  draft: 'started',
  open: 'review',
  approved: 'review',
  changes_requested: 'started',
  merged: 'completed',
  closed: 'canceled',
};

export function targetCategoryFor(state: PullRequestState): StateCategory | null {
  return CATEGORY_FOR_STATE[state];
}

export function canAdvance(current: StateCategory, target: StateCategory): boolean {
  if (current === target) return false;
  if (current === 'canceled' || current === 'completed') return false;
  return STATE_CATEGORY_ORDER[target] > STATE_CATEGORY_ORDER[current];
}

export function notificationTypeForReview(state: ReviewDecision): NotificationType {
  if (state === 'approved') return 'pr_approved';
  return 'pr_review_submitted';
}

export function notificationTypeForState(state: PullRequestState): NotificationType | null {
  if (state === 'merged') return 'pr_merged';
  if (state === 'closed') return 'pr_closed';
  return null;
}

const githubUserSchema = z.object({
  login: z.string().min(1).max(255),
  id: z.number().int().nonnegative(),
});
export type GithubUser = z.infer<typeof githubUserSchema>;

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(1024).default(''),
  html_url: z.string().url().max(2048),
  draft: z.boolean().default(false),
  merged: z.boolean().default(false),
  state: z.enum(['open', 'closed']).default('open'),
  head: z.object({ ref: z.string().max(1024).default('') }),
  base: z.object({ ref: z.string().max(1024).default('') }),
  user: githubUserSchema.nullable().optional(),
});

const repositorySchema = z.object({
  id: z.number().int().nonnegative(),
  full_name: z.string().min(1).max(512),
});

const pullRequestEventSchema = z.object({
  action: z.string().min(1).max(64),
  pull_request: pullRequestSchema,
  repository: repositorySchema,
  requested_reviewer: githubUserSchema.nullable().optional(),
  sender: githubUserSchema,
});

const reviewEventSchema = z.object({
  action: z.string().min(1).max(64),
  review: z.object({
    state: z.string().min(1).max(64),
    html_url: z.string().url().max(2048).optional(),
    user: githubUserSchema.nullable().optional(),
  }),
  pull_request: pullRequestSchema,
  repository: repositorySchema,
  sender: githubUserSchema,
});

const checkSuiteEventSchema = z.object({
  action: z.string().min(1).max(64),
  check_suite: z.object({
    conclusion: z.string().max(64).nullable().optional(),
    head_branch: z.string().max(1024).nullable().optional(),
    pull_requests: z.array(z.object({ number: z.number().int().positive() })).default([]),
  }),
  repository: repositorySchema,
  sender: githubUserSchema,
});

export interface NormalizedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly closed: boolean;
}

export interface NormalizedGithubEvent {
  readonly action: string;
  readonly repository: { readonly externalId: string; readonly fullName: string };
  readonly pullRequest: NormalizedPullRequest | null;
  readonly review: {
    readonly decision: ReviewDecision;
    readonly url: string;
    readonly reviewer: GithubUser | null;
  } | null;
  readonly requestedReviewer: GithubUser | null;
  readonly checks: {
    readonly failed: boolean;
    readonly headBranch: string;
    readonly prNumbers: number[];
  } | null;
  readonly sender: GithubUser;
}

function normalizePullRequest(pr: z.infer<typeof pullRequestSchema>): NormalizedPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    draft: pr.draft,
    merged: pr.merged,
    closed: pr.state === 'closed',
  };
}

function toReviewDecision(state: string): ReviewDecision {
  const lowered = state.toLowerCase();
  if (lowered === 'approved') return 'approved';
  if (lowered === 'changes_requested') return 'changes_requested';
  if (lowered === 'dismissed') return 'dismissed';
  return 'commented';
}

export function parseGithubEvent(eventName: string, body: unknown): NormalizedGithubEvent | null {
  if (eventName === 'pull_request') {
    const parsed = pullRequestEventSchema.parse(body);
    return {
      action: parsed.action,
      repository: {
        externalId: String(parsed.repository.id),
        fullName: parsed.repository.full_name,
      },
      pullRequest: normalizePullRequest(parsed.pull_request),
      review: null,
      requestedReviewer: parsed.requested_reviewer ?? null,
      checks: null,
      sender: parsed.sender,
    };
  }
  if (eventName === 'pull_request_review') {
    const parsed = reviewEventSchema.parse(body);
    return {
      action: parsed.action,
      repository: {
        externalId: String(parsed.repository.id),
        fullName: parsed.repository.full_name,
      },
      pullRequest: normalizePullRequest(parsed.pull_request),
      review: {
        decision: toReviewDecision(parsed.review.state),
        url: parsed.review.html_url ?? parsed.pull_request.html_url,
        reviewer: parsed.review.user ?? null,
      },
      requestedReviewer: null,
      checks: null,
      sender: parsed.sender,
    };
  }
  if (eventName === 'check_suite') {
    const parsed = checkSuiteEventSchema.parse(body);
    return {
      action: parsed.action,
      repository: {
        externalId: String(parsed.repository.id),
        fullName: parsed.repository.full_name,
      },
      pullRequest: null,
      review: null,
      requestedReviewer: null,
      checks: {
        failed: (parsed.check_suite.conclusion ?? '').toLowerCase() === 'failure',
        headBranch: parsed.check_suite.head_branch ?? '',
        prNumbers: parsed.check_suite.pull_requests.map((entry) => entry.number),
      },
      sender: parsed.sender,
    };
  }
  return null;
}
