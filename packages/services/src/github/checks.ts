export type NormalizedGithubCheckState = 'failure' | 'success' | 'pending' | 'unknown';

export function githubContextKey(parts: readonly string[]): string {
  const encoded = parts
    .map((part) => `${new TextEncoder().encode(part).byteLength}:${part}`)
    .join('');
  return `v1:${encoded}`;
}

export function normalizedGithubCheckState(
  status: string,
  conclusion: string,
): NormalizedGithubCheckState {
  const state = (conclusion || status).toLowerCase();
  if (
    [
      'failure',
      'error',
      'timed_out',
      'cancelled',
      'action_required',
      'startup_failure',
      'stale',
    ].includes(state)
  ) {
    return 'failure';
  }
  if (['success', 'neutral', 'skipped'].includes(state)) return 'success';
  if (['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(state)) {
    return 'pending';
  }
  return 'unknown';
}
