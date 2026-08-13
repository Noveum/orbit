export const ASSIGNED_SCOPE = 'assigned';
export const ALL_SCOPE = 'all';
export const PROJECT_SCOPE = 'project';
export const CYCLE_SCOPE = 'cycle';

export const ISSUES_ROOT = 'issues';
export const BOARD_ROOT = 'board-page';
export const ISSUE_SUMMARY_ROOT = 'issue-summary';
export const ISSUE_FACETS_ROOT = 'issue-facets';
export const ISSUE_ROOT = 'issue';
export const ISSUE_RELATIONS_ROOT = 'issue-relations';
export const COMMENTS_ROOT = 'comments';
export const DOC_COMMENTS_ROOT = 'doc-comments';
export const BOOTSTRAP_ROOT = 'bootstrap';
export const DOCS_ROOT = 'docs';
export const DOC_SEARCH_ROOT = 'doc-search';
export const DOCS_HOME_ROOT = 'docs-home';
export const DOC_ROOT = 'doc';
export const VIEWS_ROOT = 'views';
export const MILESTONES_ROOT = 'milestones';
export const SEARCH_ROOT = 'search';
export const VIEW_PREFERENCES_ROOT = 'view-preferences';

export const queryKeys = {
  bootstrap: (teamKey: string | null) => ['bootstrap', teamKey ?? 'default'] as const,
  issues: (teamId: string, filter = '') => ['issues', teamId, filter] as const,
  issueTeam: (teamId: string) => ['issues', teamId] as const,
  assignedIssues: (userId: string, filter = '') =>
    ['issues', ASSIGNED_SCOPE, userId, filter] as const,
  allIssues: (filter = '') => ['issues', ALL_SCOPE, filter] as const,
  projectIssues: (projectId: string, filter = '') =>
    ['issues', PROJECT_SCOPE, projectId, filter] as const,
  cycleIssues: (cycleId: string, filter = '') => ['issues', CYCLE_SCOPE, cycleId, filter] as const,
  issueCounts: (filter: string) => ['issue-counts', filter] as const,
  issueSummary: (search: string) => ['issue-summary', search] as const,
  issueFacets: (search: string) => ['issue-facets', search] as const,
  issue: (identifier: string) => ['issue', identifier] as const,
  issueRelations: (issueId: string) => ['issue-relations', issueId] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  boardPage: (search: string) => [BOARD_ROOT, search] as const,
  docAccess: (docId: string) => [DOC_ROOT, docId, 'access'] as const,
  docAccessRequests: (docId: string) => [DOC_ROOT, docId, 'access-requests'] as const,
  docGateway: (docId: string) => [DOC_ROOT, docId, 'gateway'] as const,
  docComments: (docId: string) => ['doc-comments', docId] as const,
  docs: (search: string) => ['docs', search] as const,
  docSearch: (search: string) => ['doc-search', search] as const,
  docsHome: () => ['docs-home'] as const,
  doc: (docId: string) => ['doc', docId] as const,
  docVersions: (docId: string) => ['doc', docId, 'versions'] as const,
  views: () => ['views'] as const,
  milestones: (projectId: string) => ['milestones', projectId] as const,
} as const;
