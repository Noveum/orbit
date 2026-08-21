import type {
  GithubPreviewPullRequest,
  VercelDeployment,
} from '../packages/shared/src/validators/index.ts';

export const PREVIEW_LABEL = 'preview';
export const NO_PREVIEW_LABEL = 'no-preview';

export function isPreviewEligible(pullRequest: GithubPreviewPullRequest): boolean {
  const labels = new Set(pullRequest.labels.map(({ name }) => name.toLowerCase()));
  if (labels.has(NO_PREVIEW_LABEL)) return false;
  return !pullRequest.draft || labels.has(PREVIEW_LABEL);
}

export function isSameRepositoryPullRequest(pullRequest: GithubPreviewPullRequest): boolean {
  return pullRequest.head.repo.id === pullRequest.base.repo.id;
}

export function isWebPreviewFile(filename: string): boolean {
  return (
    filename.startsWith('apps/web/') ||
    filename.startsWith('packages/') ||
    filename === 'package.json' ||
    filename === 'bun.lock' ||
    filename === 'tsconfig.base.json'
  );
}

export function isActiveVercelDeployment(deployment: VercelDeployment): boolean {
  return ['QUEUED', 'INITIALIZING', 'BUILDING'].includes(deployment.readyState);
}

export function isReadyVercelDeployment(deployment: VercelDeployment): boolean {
  return deployment.readyState === 'READY';
}

function metadataValue(deployment: VercelDeployment, key: string): string | null {
  const value = deployment.meta[key];
  return value === undefined || value === null ? null : String(value);
}

export function matchesVercelPullRequest(
  deployment: VercelDeployment,
  pullRequest: GithubPreviewPullRequest,
  projectId: string,
  headSha?: string,
): boolean {
  if (deployment.projectId !== projectId || deployment.target !== null) return false;

  const metadataMatches =
    metadataValue(deployment, 'orbitGithubRepositoryId') === String(pullRequest.base.repo.id) &&
    metadataValue(deployment, 'orbitGithubPrNumber') === String(pullRequest.number) &&
    metadataValue(deployment, 'orbitGithubHeadRef') === pullRequest.head.ref;

  if (!metadataMatches) return false;
  return headSha === undefined || metadataValue(deployment, 'orbitGithubHeadSha') === headSha;
}
