export const RECOVERABLE_PULL_STATES: readonly string[] = [
  'open',
  'draft',
  'approved',
  'changes_requested',
];

export function isActiveGithubPullRequest(pull: {
  readonly state: string;
  readonly merged: boolean;
}): boolean {
  return !pull.merged && pull.state !== 'closed' && pull.state !== 'merged';
}
