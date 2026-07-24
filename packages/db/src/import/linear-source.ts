import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const ref = z.object({ id: z.string() }).nullable().default(null);

const linearUserSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  displayName: z.string().default(''),
  email: z.string(),
  active: z.boolean().default(true),
  admin: z.boolean().default(false),
  guest: z.boolean().default(false),
});

const linearStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  position: z.number().default(0),
  color: z.string().default('#8a8a99'),
});

const linearLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable().default(null),
  parent: ref,
});

const linearCycleSchema = z.object({
  id: z.string(),
  number: z.number(),
  name: z.string().nullable().default(null),
  startsAt: z.string().nullable().default(null),
  endsAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null),
});

const linearProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(''),
  content: z.string().nullable().default(''),
  state: z.string().default('backlog'),
  startDate: z.string().nullable().default(null),
  targetDate: z.string().nullable().default(null),
  sortOrder: z.number().default(0),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  canceledAt: z.string().nullable().default(null),
  archivedAt: z.string().nullable().default(null),
  lead: ref,
});

const linearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  number: z.number(),
  title: z.string().default(''),
  description: z.string().nullable().default(''),
  priority: z.number().default(0),
  estimate: z.number().nullable().default(null),
  sortOrder: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  canceledAt: z.string().nullable().default(null),
  dueDate: z.string().nullable().default(null),
  archivedAt: z.string().nullable().default(null),
  trashed: z.boolean().nullable().default(null),
  state: ref,
  assignee: ref,
  creator: ref,
  project: ref,
  cycle: ref,
  parent: ref,
  labels: z.object({ nodes: z.array(z.object({ id: z.string() })) }).default({ nodes: [] }),
});

const linearCommentSchema = z.object({
  id: z.string(),
  body: z.string().nullable().default(''),
  createdAt: z.string(),
  updatedAt: z.string().nullable().default(null),
  issue: ref,
  user: ref,
  parent: ref,
});

export type LinearUser = z.infer<typeof linearUserSchema>;
export type LinearState = z.infer<typeof linearStateSchema>;
export type LinearLabel = z.infer<typeof linearLabelSchema>;
export type LinearCycle = z.infer<typeof linearCycleSchema>;
export type LinearProject = z.infer<typeof linearProjectSchema>;
export type LinearIssue = z.infer<typeof linearIssueSchema>;
export type LinearComment = z.infer<typeof linearCommentSchema>;

export interface LinearExport {
  readonly users: LinearUser[];
  readonly states: LinearState[];
  readonly labels: LinearLabel[];
  readonly cycles: LinearCycle[];
  readonly projects: LinearProject[];
  readonly issues: LinearIssue[];
  readonly comments: Record<string, LinearComment[]>;
}

function readJson(root: string, name: string): unknown {
  return JSON.parse(readFileSync(resolve(root, `${name}.json`), 'utf8'));
}

export function readLinearExport(root: string): LinearExport {
  return {
    users: z.array(linearUserSchema).parse(readJson(root, 'users')),
    states: z.array(linearStateSchema).parse(readJson(root, 'states')),
    labels: z.array(linearLabelSchema).parse(readJson(root, 'labels')),
    cycles: z.array(linearCycleSchema).parse(readJson(root, 'cycles')),
    projects: z.array(linearProjectSchema).parse(readJson(root, 'projects')),
    issues: z.array(linearIssueSchema).parse(readJson(root, 'issues')),
    comments: z.record(z.string(), z.array(linearCommentSchema)).parse(readJson(root, 'comments')),
  };
}

const LINEAR_STATE_CATEGORY: Record<string, string> = {
  triage: 'triage',
  backlog: 'backlog',
  unstarted: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'canceled',
  duplicate: 'canceled',
};

const REVIEW_NAMES = /\b(review|qa|verify|verification|testing|approval)\b/i;

export function linearStateCategory(state: LinearState): string {
  const base = LINEAR_STATE_CATEGORY[state.type] ?? 'backlog';
  if (base === 'started' && REVIEW_NAMES.test(state.name)) return 'review';
  return base;
}

export function isBotEmail(email: string): boolean {
  return /@linear\.linear\.app$|@oauthapp\.linear\.app$/i.test(email);
}
