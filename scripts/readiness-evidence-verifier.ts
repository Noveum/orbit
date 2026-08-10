import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  githubActionsArtifactsSchema,
  githubContentFileSchema,
  githubEvidencePullResponseSchema,
  githubWorkflowAttemptSchema,
  githubWorkflowJobsSchema,
} from '../packages/shared/src/validators/readiness.ts';
import { readTrustedGitArtifact, readTrustedGitChangedFiles } from './readiness-git-artifact.ts';
import type { ReadinessReferenceRegistrySource } from './readiness-reference-registry.ts';

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const ACTIONS_ATTEMPT =
  /^https:\/\/github\.com\/Noveum\/orbit\/actions\/runs\/([1-9]\d*)\/attempts\/([1-9]\d*)$/;
export const TRUSTED_CI_WORKFLOW_ID = 318351752;
export const TRUSTED_CI_WORKFLOW_DEFINITION_DIGEST =
  'sha256:6db001bbbd4aec66a1c8a274238073d8bdc82a1d9fe1b130c39430c2aacd5b87';

export interface HostedJobStep {
  readonly name: string;
  readonly conclusion: string | null;
}

export interface HostedJob {
  readonly name: string;
  readonly conclusion: string | null;
  readonly headSha: string;
  readonly steps: readonly HostedJobStep[];
}

export interface HostedArtifact {
  readonly name: string;
  readonly digest: string;
  readonly expired: boolean;
  readonly createdAt: string;
  readonly headSha: string;
}

export interface HostedEvidence {
  readonly headSha: string;
  readonly conclusion: string | null;
  readonly runAttempt: number;
  readonly event: string;
  readonly workflowPath: string;
  readonly workflowId: number;
  readonly workflowDefinitionDigest: string;
  readonly repository: string;
  readonly runStartedAt: string;
  readonly updatedAt: string;
  readonly pullRequestNumbers: readonly number[];
  readonly jobs: readonly HostedJob[];
  readonly artifacts: readonly HostedArtifact[];
}

export interface PullRequestEvidence {
  readonly number: number;
  readonly mergedAt: string | null;
  readonly mergeCommitSha: string | null;
  readonly headSha: string;
}

export interface ReadinessEvidenceVerifier {
  readonly verificationInstant: string;
  readonly currentCommit: string;
  readonly hostedEvidenceAvailable: boolean;
  commitExists(commit: string): boolean;
  isAncestor(ancestor: string, descendant: string): boolean;
  changedFilesBetween(ancestor: string, descendant: string): readonly string[] | undefined;
  artifactAtCommit(commit: string, path: string): string | undefined;
  hostedEvidence(url: string): HostedEvidence | undefined;
  pullRequestEvidence(number: number): PullRequestEvidence | undefined;
}

function git(root: string, args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

function gitOutput(root: string, args: readonly string[]): string {
  const result = git(root, args);
  if (result.status !== 0) throw new Error('Git evidence verification failed.');
  return String(result.stdout).trim();
}

function githubHeaders(token: string): Readonly<Record<string, string>> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function responseJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) throw new Error('Hosted evidence request failed.');
  return response.json();
}

function githubFileBytes(value: typeof githubContentFileSchema._output): Buffer | undefined {
  const bytes = Buffer.from(value.content.replaceAll('\n', ''), 'base64');
  const header = Buffer.from(`blob ${bytes.byteLength}\0`);
  const objectId = createHash('sha1').update(header).update(bytes).digest('hex');
  if (bytes.byteLength !== value.size || bytes.includes(0) || objectId !== value.sha)
    return undefined;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return bytes;
  } catch {
    return undefined;
  }
}

export async function githubWorkflowDefinitionDigest(
  commit: string,
  path: '.github/workflows/ci.yml' | '.github/workflows/readiness-scope.yml',
  token: string,
): Promise<string | undefined> {
  const result = githubContentFileSchema.safeParse(
    await responseJson(
      `https://api.github.com/repos/Noveum/orbit/contents/${path}?ref=${commit}`,
      token,
    ),
  );
  if (!result.success) return undefined;
  const bytes = githubFileBytes(result.data);
  return bytes === undefined
    ? undefined
    : `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function hostedEvidenceForUrl(
  url: string,
  token: string,
): Promise<readonly [string, HostedEvidence] | undefined> {
  const match = ACTIONS_ATTEMPT.exec(url);
  if (match === null) return undefined;
  const runId = match[1] ?? '';
  const attempt = match[2] ?? '';
  const api = `https://api.github.com/repos/Noveum/orbit/actions/runs/${runId}`;
  try {
    const [runValue, jobsValue, artifactsValue] = await Promise.all([
      responseJson(`${api}/attempts/${attempt}`, token),
      responseJson(`${api}/attempts/${attempt}/jobs?per_page=100`, token),
      responseJson(`${api}/artifacts?per_page=100`, token),
    ]);
    const run = githubWorkflowAttemptSchema.safeParse(runValue);
    const jobs = githubWorkflowJobsSchema.safeParse(jobsValue);
    const artifacts = githubActionsArtifactsSchema.safeParse(artifactsValue);
    if (
      !(run.success && jobs.success && artifacts.success) ||
      run.data.run_attempt !== Number(attempt) ||
      jobs.data.total_count > jobs.data.jobs.length ||
      artifacts.data.total_count > artifacts.data.artifacts.length
    )
      return undefined;
    const definitionDigest = await githubWorkflowDefinitionDigest(
      run.data.head_sha,
      '.github/workflows/ci.yml',
      token,
    );
    if (definitionDigest === undefined) return undefined;
    const hostedArtifacts = artifacts.data.artifacts.flatMap((artifact) =>
      typeof artifact.digest === 'string'
        ? [
            {
              name: artifact.name,
              digest: artifact.digest,
              expired: artifact.expired,
              createdAt: artifact.created_at,
              headSha: artifact.workflow_run.head_sha,
            },
          ]
        : [],
    );
    return [
      url,
      {
        headSha: run.data.head_sha,
        conclusion: run.data.conclusion,
        runAttempt: run.data.run_attempt,
        event: run.data.event,
        workflowPath: run.data.path.split('@')[0] ?? '',
        workflowId: run.data.workflow_id,
        workflowDefinitionDigest: definitionDigest,
        repository: run.data.repository.full_name,
        runStartedAt: run.data.run_started_at,
        updatedAt: run.data.updated_at,
        pullRequestNumbers: run.data.pull_requests.map((pullRequest) => pullRequest.number),
        jobs: jobs.data.jobs.map((job) => ({
          name: job.name,
          conclusion: job.conclusion,
          headSha: job.head_sha,
          steps: job.steps.map((step) => ({
            name: step.name,
            conclusion: step.conclusion,
          })),
        })),
        artifacts: hostedArtifacts,
      },
    ];
  } catch {
    return undefined;
  }
}

async function loadHostedEvidence(
  source: ReadinessReferenceRegistrySource,
  token: string,
  selectedUrls: readonly string[] | undefined,
): Promise<ReadonlyMap<string, HostedEvidence>> {
  const urls = new Set(
    selectedUrls ??
      source.recordEntries.flatMap(([, record]) =>
        ['failing-test', 'test', 'gate'].includes(record.kind) && ACTIONS_ATTEMPT.test(record.url)
          ? [record.url]
          : [],
      ),
  );
  const values = await Promise.all([...urls].map((url) => hostedEvidenceForUrl(url, token)));
  return new Map(
    values.filter((value): value is readonly [string, HostedEvidence] => value !== undefined),
  );
}

async function pullRequestEvidenceForNumber(
  number: number,
  token: string,
): Promise<readonly [number, PullRequestEvidence] | undefined> {
  try {
    const result = githubEvidencePullResponseSchema.safeParse(
      await responseJson(`https://api.github.com/repos/Noveum/orbit/pulls/${number}`, token),
    );
    if (!result.success || result.data.number !== number) return undefined;
    return [
      number,
      {
        number,
        mergedAt: result.data.merged_at,
        mergeCommitSha: result.data.merge_commit_sha,
        headSha: result.data.head.sha,
      },
    ];
  } catch {
    return undefined;
  }
}

async function loadPullRequestEvidence(
  source: ReadinessReferenceRegistrySource,
  token: string,
  selectedNumbers: readonly number[] | undefined,
): Promise<ReadonlyMap<number, PullRequestEvidence>> {
  const numbers = new Set(
    selectedNumbers ??
      source.recordEntries.flatMap(([, record]) =>
        record.kind === 'implementation' || record.kind === 'failing-test'
          ? [record.pullRequest.number]
          : [],
      ),
  );
  const values = await Promise.all(
    [...numbers].map((number) => pullRequestEvidenceForNumber(number, token)),
  );
  return new Map(
    values.filter((value): value is readonly [number, PullRequestEvidence] => value !== undefined),
  );
}

export async function createProductionReadinessEvidenceVerifier(
  root: string,
  source: ReadinessReferenceRegistrySource,
  options: {
    readonly currentCommit?: string;
    readonly hostedEvidenceUrls?: readonly string[];
    readonly now?: Date;
    readonly pullRequestNumbers?: readonly number[];
  } = {},
): Promise<ReadinessEvidenceVerifier> {
  const currentCommit = options.currentCommit ?? gitOutput(root, ['rev-parse', 'HEAD']);
  if (!FULL_COMMIT.test(currentCommit)) throw new Error('Git evidence verification failed.');
  const token = process.env['GITHUB_TOKEN'];
  const hostedEvidenceAvailable =
    token !== undefined && token.length > 0 && process.env['GITHUB_REPOSITORY'] === 'Noveum/orbit';
  const [hosted, pullRequests] = hostedEvidenceAvailable
    ? await Promise.all([
        loadHostedEvidence(source, token ?? '', options.hostedEvidenceUrls),
        loadPullRequestEvidence(source, token ?? '', options.pullRequestNumbers),
      ])
    : [new Map<string, HostedEvidence>(), new Map<number, PullRequestEvidence>()];
  return {
    verificationInstant: (options.now ?? new Date()).toISOString(),
    currentCommit,
    hostedEvidenceAvailable,
    commitExists: (commit) =>
      FULL_COMMIT.test(commit) && git(root, ['cat-file', '-e', `${commit}^{commit}`]).status === 0,
    isAncestor: (ancestor, descendant) =>
      FULL_COMMIT.test(ancestor) &&
      FULL_COMMIT.test(descendant) &&
      git(root, ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0,
    changedFilesBetween: (ancestor, descendant) => {
      if (!(FULL_COMMIT.test(ancestor) && FULL_COMMIT.test(descendant))) return undefined;
      try {
        return readTrustedGitChangedFiles(root, ancestor, descendant);
      } catch {
        return undefined;
      }
    },
    artifactAtCommit: (commit, path) => {
      if (!FULL_COMMIT.test(commit)) return undefined;
      try {
        return readTrustedGitArtifact(root, commit, path);
      } catch {
        return undefined;
      }
    },
    hostedEvidence: (url) => hosted.get(url),
    pullRequestEvidence: (number) => pullRequests.get(number),
  };
}
