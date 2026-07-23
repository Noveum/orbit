export const queryKeys = {
  bootstrap: (teamKey: string | null) => ['bootstrap', teamKey ?? 'default'] as const,
  issues: (teamId: string) => ['issues', teamId] as const,
  issue: (identifier: string) => ['issue', identifier] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  docs: (search: string) => ['docs', search] as const,
  doc: (docId: string) => ['doc', docId] as const,
} as const;

export const ISSUES_ROOT = 'issues';
export const ISSUE_ROOT = 'issue';
export const COMMENTS_ROOT = 'comments';
export const BOOTSTRAP_ROOT = 'bootstrap';
export const DOCS_ROOT = 'docs';
export const DOC_ROOT = 'doc';
