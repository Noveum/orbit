export const queryKeys = {
  bootstrap: (teamKey: string | null) => ['bootstrap', teamKey ?? 'default'] as const,
  issues: (teamId: string, filter = '') => ['issues', teamId, filter] as const,
  issueTeam: (teamId: string) => ['issues', teamId] as const,
  issue: (identifier: string) => ['issue', identifier] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  views: () => ['views'] as const,
} as const;

export const ISSUES_ROOT = 'issues';
export const ISSUE_ROOT = 'issue';
export const COMMENTS_ROOT = 'comments';
export const BOOTSTRAP_ROOT = 'bootstrap';
export const VIEWS_ROOT = 'views';
