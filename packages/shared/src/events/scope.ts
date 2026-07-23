export const scopes = {
  organization: (organizationId: string): string => `org:${organizationId}`,
  team: (teamId: string): string => `team:${teamId}`,
  project: (projectId: string): string => `project:${projectId}`,
  issue: (issueId: string): string => `issue:${issueId}`,
  doc: (docId: string): string => `doc:${docId}`,
  user: (userId: string): string => `user:${userId}`,
} as const;
