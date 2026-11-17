export function isActiveGithubPullRequest(pull: {
  readonly state: string;
  readonly merged: boolean;
}): boolean {
  return !pull.merged && pull.state !== 'closed' && pull.state !== 'merged';
}
