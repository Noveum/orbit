import { createHmac, timingSafeEqual } from 'node:crypto';
import { type NotificationType, STATE_CATEGORY_ORDER, type StateCategory } from '@orbit/shared';
import { z } from 'zod';

export * from './app.ts';
export * from './apply.ts';
export * from './associations.ts';
export * from './installations.ts';
export * from './watched.ts';
export * from './webhook-events.ts';

import { isGithubInstallationEvent } from './webhook-events.ts';

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
  id: z.number().int().nonnegative().default(0),
  node_id: z.string().max(255).default(''),
  number: z.number().int().positive(),
  title: z.string().max(1024).default(''),
  body: z.string().max(65536).nullable().default(null),
  html_url: z.string().url().max(2048),
  draft: z.boolean().default(false),
  merged: z.boolean().default(false),
  state: z.enum(['open', 'closed']).default('open'),
  head: z.object({
    ref: z.string().max(1024).default(''),
    sha: z.string().max(255).default(''),
  }),
  base: z.object({ ref: z.string().max(1024).default('') }),
  user: githubUserSchema.nullable().optional(),
  created_at: z.string().datetime().nullable().optional(),
  updated_at: z.string().datetime().nullable().optional(),
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
    id: z.number().int().nonnegative().default(0),
    state: z.string().min(1).max(64),
    body: z.string().max(65536).nullable().default(null),
    html_url: z.string().url().max(2048).optional(),
    user: githubUserSchema.nullable().optional(),
    submitted_at: z.string().datetime().nullable().optional(),
  }),
  pull_request: pullRequestSchema,
  repository: repositorySchema,
  sender: githubUserSchema,
});

const checkSuiteEventSchema = z.object({
  action: z.string().min(1).max(64),
  check_suite: z.object({
    id: z.number().int().nonnegative().default(0),
    status: z.string().max(64).nullable().optional(),
    conclusion: z.string().max(64).nullable().optional(),
    head_branch: z.string().max(1024).nullable().optional(),
    pull_requests: z.array(z.object({ number: z.number().int().positive() })).default([]),
  }),
  repository: repositorySchema,
  sender: githubUserSchema,
});

const checkRunEventSchema = z.object({
  action: z.string().min(1).max(64),
  check_run: z.object({
    id: z.number().int().nonnegative(),
    name: z.string().max(255).default(''),
    status: z.string().max(64).nullable().optional(),
    conclusion: z.string().max(64).nullable().optional(),
    html_url: z.string().url().max(2048).nullable().optional(),
    head_sha: z.string().max(255).default(''),
    pull_requests: z.array(z.object({ number: z.number().int().positive() })).default([]),
    check_suite: z
      .object({ head_branch: z.string().max(1024).nullable().optional() })
      .nullable()
      .optional(),
    completed_at: z.string().datetime().nullable().optional(),
    started_at: z.string().datetime().nullable().optional(),
  }),
  repository: repositorySchema,
  sender: githubUserSchema,
});

const statusEventSchema = z.object({
  id: z.number().int().nonnegative().default(0),
  sha: z.string().min(1).max(255),
  state: z.string().min(1).max(64),
  context: z.string().max(255).default(''),
  description: z.string().max(1024).nullable().default(null),
  target_url: z.string().url().max(2048).nullable().default(null),
  repository: repositorySchema,
  sender: githubUserSchema,
  updated_at: z.string().datetime().nullable().optional(),
});

const workflowRunEventSchema = z.object({
  action: z.string().min(1).max(64),
  workflow_run: z.object({
    id: z.number().int().nonnegative(),
    name: z.string().max(255).default(''),
    status: z.string().max(64).nullable().optional(),
    conclusion: z.string().max(64).nullable().optional(),
    html_url: z.string().url().max(2048).nullable().optional(),
    head_branch: z.string().max(1024).nullable().optional(),
    head_sha: z.string().max(255).default(''),
    pull_requests: z.array(z.object({ number: z.number().int().positive() })).default([]),
    run_started_at: z.string().datetime().nullable().optional(),
    updated_at: z.string().datetime().nullable().optional(),
  }),
  repository: repositorySchema,
  sender: githubUserSchema,
});

const commentSchema = z.object({
  id: z.number().int().nonnegative().default(0),
  body: z.string().max(65536).default(''),
  html_url: z.string().url().max(2048),
  user: githubUserSchema.nullable().optional(),
  path: z.string().max(4096).nullable().optional(),
  line: z.number().int().positive().nullable().optional(),
  created_at: z.string().datetime().nullable().optional(),
  updated_at: z.string().datetime().nullable().optional(),
});

const issueCommentEventSchema = z.object({
  action: z.string().min(1).max(64),
  issue: z.object({
    number: z.number().int().positive(),
    title: z.string().max(1024).default(''),
    html_url: z.string().url().max(2048),
    pull_request: z.object({ url: z.string().url().max(2048) }).optional(),
  }),
  comment: commentSchema,
  repository: repositorySchema,
  sender: githubUserSchema,
});

const reviewCommentEventSchema = z.object({
  action: z.string().min(1).max(64),
  pull_request: pullRequestSchema,
  comment: commentSchema,
  repository: repositorySchema,
  sender: githubUserSchema,
});

const reviewThreadEventSchema = z.object({
  action: z.enum(['resolved', 'unresolved']),
  thread: z.object({
    id: z.number().int().nonnegative(),
    updated_at: z.string().datetime().nullable().optional(),
  }),
  pull_request: pullRequestSchema,
  repository: repositorySchema,
  sender: githubUserSchema,
});

export interface NormalizedPullRequest {
  readonly externalId: string;
  readonly nodeId: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly closed: boolean;
  readonly author: GithubUser | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export type GithubActivityType =
  | 'pull_request'
  | 'review_request'
  | 'review'
  | 'comment'
  | 'review_comment'
  | 'review_thread'
  | 'checks';

export interface NormalizedGithubActivity {
  readonly externalId: string;
  readonly type: GithubActivityType;
  readonly body: string;
  readonly url: string;
  readonly state: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly occurredAt: string | null;
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
    readonly headSha: string;
    readonly prNumbers: number[];
    readonly status: string;
    readonly conclusion: string;
  } | null;
  readonly comment: {
    readonly body: string;
    readonly url: string;
    readonly kind: 'conversation' | 'inline';
  } | null;
  readonly activity: NormalizedGithubActivity;
  readonly sender: GithubUser;
}

function normalizePullRequest(pr: z.infer<typeof pullRequestSchema>): NormalizedPullRequest {
  return {
    externalId: pr.id === 0 ? '' : String(pr.id),
    nodeId: pr.node_id,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    url: pr.html_url,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    draft: pr.draft,
    merged: pr.merged,
    closed: pr.state === 'closed',
    author: pr.user ?? null,
    createdAt: pr.created_at ?? null,
    updatedAt: pr.updated_at ?? null,
  };
}

function activityId(prefix: string, id: number, fallback: string): string {
  return id === 0 ? `${prefix}:${fallback}` : `${prefix}:${id}`;
}

function toReviewDecision(state: string): ReviewDecision {
  const lowered = state.toLowerCase();
  if (lowered === 'approved') return 'approved';
  if (lowered === 'changes_requested') return 'changes_requested';
  if (lowered === 'dismissed') return 'dismissed';
  return 'commented';
}

function parsePullRequestEvent(body: unknown): NormalizedGithubEvent | null {
  const result = pullRequestEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
  const pr = normalizePullRequest(parsed.pull_request);
  const reviewer = parsed.requested_reviewer ?? null;
  return {
    action: parsed.action,
    repository: {
      externalId: String(parsed.repository.id),
      fullName: parsed.repository.full_name,
    },
    pullRequest: pr,
    review: null,
    requestedReviewer: reviewer,
    checks: null,
    comment: null,
    activity: {
      externalId:
        parsed.action === 'review_requested' && reviewer !== null
          ? `review_request:${reviewer.id}:${pr.updatedAt ?? pr.number}`
          : `pull_request:${pr.externalId || pr.number}:${parsed.action}:${pr.updatedAt ?? `${pr.draft}:${pr.merged}:${pr.closed}`}`,
      type: parsed.action === 'review_requested' ? 'review_request' : 'pull_request',
      body: '',
      url: pr.url,
      state: parsed.action,
      path: null,
      line: null,
      occurredAt: pr.updatedAt,
    },
    sender: parsed.sender,
  };
}

function parseReviewEvent(body: unknown): NormalizedGithubEvent | null {
  const result = reviewEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
  const pr = normalizePullRequest(parsed.pull_request);
  const decision = toReviewDecision(parsed.review.state);
  return {
    action: parsed.action,
    repository: {
      externalId: String(parsed.repository.id),
      fullName: parsed.repository.full_name,
    },
    pullRequest: pr,
    review: {
      decision,
      url: parsed.review.html_url ?? parsed.pull_request.html_url,
      reviewer: parsed.review.user ?? null,
    },
    requestedReviewer: null,
    checks: null,
    comment: null,
    activity: {
      externalId: activityId(
        'review',
        parsed.review.id,
        `${pr.number}:${decision}:${parsed.review.submitted_at ?? pr.updatedAt ?? parsed.action}`,
      ),
      type: 'review',
      body: parsed.review.body ?? '',
      url: parsed.review.html_url ?? pr.url,
      state: decision,
      path: null,
      line: null,
      occurredAt: parsed.review.submitted_at ?? pr.updatedAt,
    },
    sender: parsed.sender,
  };
}

function parseCheckSuiteEvent(body: unknown): NormalizedGithubEvent | null {
  const result = checkSuiteEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
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
      failed: [
        'failure',
        'error',
        'timed_out',
        'cancelled',
        'action_required',
        'startup_failure',
        'stale',
      ].includes((parsed.check_suite.conclusion ?? '').toLowerCase()),
      headBranch: parsed.check_suite.head_branch ?? '',
      headSha: '',
      prNumbers: parsed.check_suite.pull_requests.map((entry) => entry.number),
      status: parsed.check_suite.status ?? '',
      conclusion: parsed.check_suite.conclusion ?? '',
    },
    comment: null,
    activity: {
      externalId: `check_suite:${parsed.check_suite.id || parsed.check_suite.head_branch || 'unknown'}:${parsed.action}:${parsed.check_suite.conclusion ?? parsed.check_suite.status ?? ''}`,
      type: 'checks',
      body: '',
      url: '',
      state: parsed.check_suite.conclusion ?? parsed.check_suite.status ?? parsed.action,
      path: null,
      line: null,
      occurredAt: null,
    },
    sender: parsed.sender,
  };
}

function normalizedCheckEvent(input: {
  readonly action: string;
  readonly repository: z.infer<typeof repositorySchema>;
  readonly sender: GithubUser;
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string;
  readonly url: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly prNumbers: number[];
  readonly occurredAt: string | null;
  readonly prefix: string;
}): NormalizedGithubEvent {
  const state = input.conclusion || input.status || input.action;
  return {
    action: input.action,
    repository: {
      externalId: String(input.repository.id),
      fullName: input.repository.full_name,
    },
    pullRequest: null,
    review: null,
    requestedReviewer: null,
    checks: {
      failed: [
        'failure',
        'error',
        'timed_out',
        'cancelled',
        'action_required',
        'startup_failure',
        'stale',
      ].includes(input.conclusion.toLowerCase()),
      headBranch: input.headBranch,
      headSha: input.headSha,
      prNumbers: input.prNumbers,
      status: input.status,
      conclusion: input.conclusion,
    },
    comment: null,
    activity: {
      externalId: `${input.prefix}:${input.id}:${input.action}:${state}`,
      type: 'checks',
      body: input.name,
      url: input.url,
      state,
      path: null,
      line: null,
      occurredAt: input.occurredAt,
    },
    sender: input.sender,
  };
}

function parseCheckRunEvent(body: unknown): NormalizedGithubEvent | null {
  const result = checkRunEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
  return normalizedCheckEvent({
    action: parsed.action,
    repository: parsed.repository,
    sender: parsed.sender,
    id: parsed.check_run.id,
    name: parsed.check_run.name,
    status: parsed.check_run.status ?? '',
    conclusion: parsed.check_run.conclusion ?? '',
    url: parsed.check_run.html_url ?? '',
    headBranch: parsed.check_run.check_suite?.head_branch ?? '',
    headSha: parsed.check_run.head_sha,
    prNumbers: parsed.check_run.pull_requests.map((entry) => entry.number),
    occurredAt: parsed.check_run.completed_at ?? parsed.check_run.started_at ?? null,
    prefix: 'check_run',
  });
}

function parseStatusEvent(body: unknown): NormalizedGithubEvent | null {
  const result = statusEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
  return normalizedCheckEvent({
    action: 'updated',
    repository: parsed.repository,
    sender: parsed.sender,
    id: parsed.id,
    name: parsed.description ?? parsed.context,
    status: parsed.state,
    conclusion: parsed.state,
    url: parsed.target_url ?? '',
    headBranch: '',
    headSha: parsed.sha,
    prNumbers: [],
    occurredAt: parsed.updated_at ?? null,
    prefix: `status:${parsed.context}`,
  });
}

function parseWorkflowRunEvent(body: unknown): NormalizedGithubEvent | null {
  const result = workflowRunEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
  return normalizedCheckEvent({
    action: parsed.action,
    repository: parsed.repository,
    sender: parsed.sender,
    id: parsed.workflow_run.id,
    name: parsed.workflow_run.name,
    status: parsed.workflow_run.status ?? '',
    conclusion: parsed.workflow_run.conclusion ?? '',
    url: parsed.workflow_run.html_url ?? '',
    headBranch: parsed.workflow_run.head_branch ?? '',
    headSha: parsed.workflow_run.head_sha,
    prNumbers: parsed.workflow_run.pull_requests.map((entry) => entry.number),
    occurredAt: parsed.workflow_run.updated_at ?? parsed.workflow_run.run_started_at ?? null,
    prefix: 'workflow_run',
  });
}

function parseIssueCommentEvent(body: unknown): NormalizedGithubEvent | null {
  const result = issueCommentEventSchema.safeParse(body);
  if (!result.success || result.data.issue.pull_request === undefined) return null;
  const parsed = result.data;
  return {
    action: parsed.action,
    repository: {
      externalId: String(parsed.repository.id),
      fullName: parsed.repository.full_name,
    },
    pullRequest: {
      externalId: '',
      nodeId: '',
      number: parsed.issue.number,
      title: parsed.issue.title,
      body: '',
      url: parsed.issue.html_url,
      headRef: '',
      headSha: '',
      baseRef: '',
      draft: false,
      merged: false,
      closed: false,
      author: null,
      createdAt: null,
      updatedAt: parsed.comment.updated_at ?? parsed.comment.created_at ?? null,
    },
    review: null,
    requestedReviewer: null,
    checks: null,
    comment: {
      body: parsed.comment.body.slice(0, 4000),
      url: parsed.comment.html_url,
      kind: 'conversation',
    },
    activity: {
      externalId: activityId(
        'comment',
        parsed.comment.id,
        `${parsed.issue.number}:${parsed.comment.html_url}`,
      ),
      type: 'comment',
      body: parsed.comment.body.slice(0, 4000),
      url: parsed.comment.html_url,
      state: parsed.action,
      path: null,
      line: null,
      occurredAt: parsed.comment.updated_at ?? parsed.comment.created_at ?? null,
    },
    sender: parsed.sender,
  };
}

function parseReviewCommentEvent(body: unknown): NormalizedGithubEvent | null {
  const result = reviewCommentEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
  const pr = normalizePullRequest(parsed.pull_request);
  return {
    action: parsed.action,
    repository: {
      externalId: String(parsed.repository.id),
      fullName: parsed.repository.full_name,
    },
    pullRequest: pr,
    review: null,
    requestedReviewer: null,
    checks: null,
    comment: {
      body: parsed.comment.body.slice(0, 4000),
      url: parsed.comment.html_url,
      kind: 'inline',
    },
    activity: {
      externalId: activityId(
        'review_comment',
        parsed.comment.id,
        `${pr.number}:${parsed.comment.html_url}`,
      ),
      type: 'review_comment',
      body: parsed.comment.body.slice(0, 4000),
      url: parsed.comment.html_url,
      state: parsed.action,
      path: parsed.comment.path ?? null,
      line: parsed.comment.line ?? null,
      occurredAt: parsed.comment.updated_at ?? parsed.comment.created_at ?? pr.updatedAt,
    },
    sender: parsed.sender,
  };
}

function parseReviewThreadEvent(body: unknown): NormalizedGithubEvent | null {
  const result = reviewThreadEventSchema.safeParse(body);
  if (!result.success) return null;
  const parsed = result.data;
  const pr = normalizePullRequest(parsed.pull_request);
  return {
    action: parsed.action,
    repository: {
      externalId: String(parsed.repository.id),
      fullName: parsed.repository.full_name,
    },
    pullRequest: pr,
    review: null,
    requestedReviewer: null,
    checks: null,
    comment: null,
    activity: {
      externalId: `review_thread:${parsed.thread.id}:${parsed.action}`,
      type: 'review_thread',
      body: '',
      url: pr.url,
      state: parsed.action,
      path: null,
      line: null,
      occurredAt: parsed.thread.updated_at ?? pr.updatedAt,
    },
    sender: parsed.sender,
  };
}

const GITHUB_EVENT_PARSERS: Readonly<
  Record<string, (body: unknown) => NormalizedGithubEvent | null>
> = {
  pull_request: parsePullRequestEvent,
  pull_request_review: parseReviewEvent,
  issue_comment: parseIssueCommentEvent,
  pull_request_review_comment: parseReviewCommentEvent,
  pull_request_review_thread: parseReviewThreadEvent,
  check_suite: parseCheckSuiteEvent,
  check_run: parseCheckRunEvent,
  status: parseStatusEvent,
  workflow_run: parseWorkflowRunEvent,
};

export const GITHUB_PARSED_EVENTS: readonly string[] = Object.keys(GITHUB_EVENT_PARSERS);

export function parseGithubEvent(eventName: string, body: unknown): NormalizedGithubEvent | null {
  return GITHUB_EVENT_PARSERS[eventName]?.(body) ?? null;
}

export function handlesGithubEvent(eventName: string): boolean {
  return isGithubInstallationEvent(eventName) || eventName in GITHUB_EVENT_PARSERS;
}
