import type { Database, Transaction } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { notifyGithubCheckFailureTransitions } from './notifications.ts';
import {
  type ReconcileNextGithubPullRequestInput,
  reconcileNextGithubPullRequest,
} from './pull-reconciliation.ts';
import {
  type ReconcileNextGithubCheckHeadInput,
  reconcileNextGithubCheckHead,
} from './reconciliation.ts';

type GithubWorkerDatabase = Database | Transaction;
type CheckHeadReconciler = (
  database: GithubWorkerDatabase,
  input: ReconcileNextGithubCheckHeadInput,
) => ReturnType<typeof reconcileNextGithubCheckHead>;
type PullRequestReconciler = (
  database: GithubWorkerDatabase,
  input: ReconcileNextGithubPullRequestInput,
) => ReturnType<typeof reconcileNextGithubPullRequest>;

export interface ReconcilePendingGithubWorkInput {
  readonly appId: string;
  readonly privateKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
  readonly limit?: number;
  readonly deadlineAt?: Date;
  readonly now?: () => Date;
  readonly slackEnabled?: boolean;
  readonly reconcileCheckHead?: CheckHeadReconciler;
  readonly reconcilePullRequest?: PullRequestReconciler;
  readonly notifyCheckFailureTransitions?: typeof notifyGithubCheckFailureTransitions;
}

export interface GithubReconciliationBatchResult {
  readonly processed: number;
  readonly checkHeads: number;
  readonly pullRequests: number;
  readonly accepted: number;
  readonly retryScheduled: number;
  readonly failed: number;
  readonly actions: SyncAction[];
}

const DEFAULT_JOB_LIMIT = 20;
const MAX_JOB_LIMIT = 100;
const DEFAULT_WORKER_WINDOW_MS = 240_000;

function jobLimit(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return DEFAULT_JOB_LIMIT;
  return Math.min(value, MAX_JOB_LIMIT);
}

function recordStatus(
  result: GithubReconciliationBatchResult,
  status: string,
): GithubReconciliationBatchResult {
  return {
    ...result,
    accepted: result.accepted + (status === 'accepted' ? 1 : 0),
    retryScheduled: result.retryScheduled + (status === 'retry_scheduled' ? 1 : 0),
    failed: result.failed + (status === 'failed' || status === 'unavailable' ? 1 : 0),
  };
}

async function processCheckHead(input: {
  readonly database: GithubWorkerDatabase;
  readonly worker: ReconcilePendingGithubWorkInput;
  readonly reconcile: CheckHeadReconciler;
  readonly now: () => Date;
  readonly result: GithubReconciliationBatchResult;
}): Promise<{ readonly idle: boolean; readonly result: GithubReconciliationBatchResult }> {
  const actions: SyncAction[] = [];
  const notifyCheckFailureTransitions =
    input.worker.notifyCheckFailureTransitions ?? notifyGithubCheckFailureTransitions;
  const check = await input.reconcile(input.database, {
    appId: input.worker.appId,
    privateKey: input.worker.privateKey,
    ...(input.worker.fetch === undefined ? {} : { fetch: input.worker.fetch }),
    ...(input.worker.apiBase === undefined ? {} : { apiBase: input.worker.apiBase }),
    acceptFailureTransitions: async (tx, transitions) => {
      if (transitions.length === 0) return;
      const outcome = await notifyCheckFailureTransitions(tx, transitions, {
        now: input.now(),
        ...(input.worker.slackEnabled === undefined
          ? {}
          : { slackEnabled: input.worker.slackEnabled }),
      });
      actions.push(...outcome.actions);
    },
  });
  if (check.status === 'idle') return { idle: true, result: input.result };
  return {
    idle: false,
    result: recordStatus(
      {
        ...input.result,
        processed: input.result.processed + 1,
        checkHeads: input.result.checkHeads + 1,
        actions: [...input.result.actions, ...actions],
      },
      check.status,
    ),
  };
}

async function processPullRequest(input: {
  readonly database: GithubWorkerDatabase;
  readonly worker: ReconcilePendingGithubWorkInput;
  readonly reconcile: PullRequestReconciler;
  readonly result: GithubReconciliationBatchResult;
}): Promise<{ readonly idle: boolean; readonly result: GithubReconciliationBatchResult }> {
  const pull = await input.reconcile(input.database, {
    appId: input.worker.appId,
    privateKey: input.worker.privateKey,
    ...(input.worker.fetch === undefined ? {} : { fetch: input.worker.fetch }),
    ...(input.worker.apiBase === undefined ? {} : { apiBase: input.worker.apiBase }),
  });
  if (pull.status === 'idle') return { idle: true, result: input.result };
  return {
    idle: false,
    result: recordStatus(
      {
        ...input.result,
        processed: input.result.processed + 1,
        pullRequests: input.result.pullRequests + 1,
      },
      pull.status,
    ),
  };
}

export async function reconcilePendingGithubWork(
  database: GithubWorkerDatabase,
  input: ReconcilePendingGithubWorkInput,
): Promise<GithubReconciliationBatchResult> {
  const now = input.now ?? (() => new Date());
  const deadlineAt = input.deadlineAt ?? new Date(now().getTime() + DEFAULT_WORKER_WINDOW_MS);
  const limit = jobLimit(input.limit);
  const reconcileCheckHead = input.reconcileCheckHead ?? reconcileNextGithubCheckHead;
  const reconcilePullRequest = input.reconcilePullRequest ?? reconcileNextGithubPullRequest;
  let result: GithubReconciliationBatchResult = {
    processed: 0,
    checkHeads: 0,
    pullRequests: 0,
    accepted: 0,
    retryScheduled: 0,
    failed: 0,
    actions: [],
  };
  while (result.processed < limit && now().getTime() < deadlineAt.getTime()) {
    const check = await processCheckHead({
      database,
      worker: input,
      reconcile: reconcileCheckHead,
      now,
      result,
    });
    result = check.result;
    if (result.processed >= limit || now().getTime() >= deadlineAt.getTime()) break;
    const pull = await processPullRequest({
      database,
      worker: input,
      reconcile: reconcilePullRequest,
      result,
    });
    result = pull.result;
    if (check.idle && pull.idle) break;
  }
  return result;
}
