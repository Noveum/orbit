import type * as schema from '../schema/index.ts';

export interface ImportRows {
  readonly users: (typeof schema.user.$inferInsert)[];
  readonly members: (typeof schema.member.$inferInsert)[];
  readonly teams: (typeof schema.team.$inferInsert)[];
  readonly teamMembers: (typeof schema.teamMember.$inferInsert)[];
  readonly states: (typeof schema.workflowState.$inferInsert)[];
  readonly labels: (typeof schema.label.$inferInsert)[];
  readonly projects: (typeof schema.project.$inferInsert)[];
  readonly projectTeams: (typeof schema.projectTeam.$inferInsert)[];
  readonly cycles: (typeof schema.cycle.$inferInsert)[];
  readonly milestones: (typeof schema.milestone.$inferInsert)[];
  readonly issues: (typeof schema.issue.$inferInsert)[];
  readonly issueLabels: (typeof schema.issueLabel.$inferInsert)[];
  readonly comments: (typeof schema.comment.$inferInsert)[];
  readonly collections: (typeof schema.docCollection.$inferInsert)[];
  readonly docs: (typeof schema.doc.$inferInsert)[];
}

export function emptyRows(): ImportRows {
  return {
    users: [],
    members: [],
    teams: [],
    teamMembers: [],
    states: [],
    labels: [],
    projects: [],
    projectTeams: [],
    cycles: [],
    milestones: [],
    issues: [],
    issueLabels: [],
    comments: [],
    collections: [],
    docs: [],
  };
}

export function countRows(rows: ImportRows): string {
  return [
    `${rows.users.length} users`,
    `${rows.teams.length} teams`,
    `${rows.states.length} states`,
    `${rows.labels.length} labels`,
    `${rows.projects.length} projects`,
    `${rows.cycles.length} cycles`,
    `${rows.milestones.length} milestones`,
    `${rows.issues.length} issues`,
    `${rows.issueLabels.length} issue labels`,
    `${rows.comments.length} comments`,
    `${rows.docs.length} docs`,
  ].join(', ');
}
