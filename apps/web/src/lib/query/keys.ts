export const ASSIGNED_SCOPE = 'assigned';
export const ALL_SCOPE = 'all';

export const queryKeys = {
  bootstrap: (teamKey: string | null) => ['bootstrap', teamKey ?? 'default'] as const,
  issues: (teamId: string, filter = '') => ['issues', teamId, filter] as const,
  issueTeam: (teamId: string) => ['issues', teamId] as const,
  assignedIssues: (userId: string, filter = '') =>
    ['issues', ASSIGNED_SCOPE, userId, filter] as const,
  allIssues: (filter = '') => ['issues', ALL_SCOPE, filter] as const,
  issueCounts: (filter: string) => ['issue-counts', filter] as const,
  issueSummary: (search: string) => ['issue-summary', search] as const,
  issue: (identifier: string) => ['issue', identifier] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  docComments: (docId: string) => ['doc-comments', docId] as const,
  docs: (search: string) => ['docs', search] as const,
  doc: (docId: string) => ['doc', docId] as const,
  docVersions: (docId: string) => ['doc', docId, 'versions'] as const,
  views: () => ['views'] as const,
  standupToday: (teamId: string) => ['standup', 'today', teamId] as const,
  standupHistory: (teamId: string) => ['standup', 'history', teamId] as const,
} as const;

export const ISSUES_ROOT = 'issues';
export const ISSUE_SUMMARY_ROOT = 'issue-summary';
export const ISSUE_ROOT = 'issue';
export const COMMENTS_ROOT = 'comments';
export const DOC_COMMENTS_ROOT = 'doc-comments';
export const BOOTSTRAP_ROOT = 'bootstrap';
export const DOCS_ROOT = 'docs';
export const DOC_ROOT = 'doc';
export const VIEWS_ROOT = 'views';
export const STANDUP_ROOT = 'standup';
