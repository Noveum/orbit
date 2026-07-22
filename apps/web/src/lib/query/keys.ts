export const queryKeys = {
  bootstrap: (teamKey: string | null) => ['bootstrap', teamKey ?? 'default'] as const,
  issues: (teamId: string) => ['issues', teamId] as const,
  issue: (identifier: string) => ['issue', identifier] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
} as const;

export const ISSUES_ROOT = 'issues';
export const ISSUE_ROOT = 'issue';
export const COMMENTS_ROOT = 'comments';
export const BOOTSTRAP_ROOT = 'bootstrap';
