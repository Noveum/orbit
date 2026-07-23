import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const planeMemberSchema = z.object({
  id: z.string(),
  first_name: z.string().default(''),
  last_name: z.string().default(''),
  email: z.string(),
  display_name: z.string().default(''),
  avatar_url: z.string().nullable().default(null),
  role_slug: z.string().default('member'),
  is_active: z.boolean().default(true),
  is_bot: z.boolean().default(false),
});

const planeProjectSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
  description: z.string().nullable().default(''),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
  archived_at: z.string().nullable().default(null),
  project_lead: z.string().nullable().default(null),
});

const planeStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().default('#8a8a99'),
  group: z.string(),
  sequence: z.number().default(0),
  is_triage: z.boolean().default(false),
  default: z.boolean().default(false),
  created_at: z.string(),
});

const planeLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable().default(null),
  created_at: z.string(),
});

const planeCycleSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_date: z.string().nullable().default(null),
  end_date: z.string().nullable().default(null),
  created_at: z.string(),
});

const planeModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(''),
  target_date: z.string().nullable().default(null),
  created_at: z.string(),
});

const planeIssueSchema = z.object({
  id: z.string(),
  name: z.string(),
  description_html: z.string().nullable().default(''),
  description_stripped: z.string().nullable().default(''),
  priority: z.string().default('none'),
  sequence_id: z.number(),
  sort_order: z.number().default(1024),
  state: z.string(),
  state_group: z.string().nullable().default(null),
  parent: z.string().nullable().default(null),
  cycle_id: z.string().nullable().default(null),
  assignees: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  created_by: z.string().nullable().default(null),
  start_date: z.string().nullable().default(null),
  target_date: z.string().nullable().default(null),
  estimate_point: z.union([z.number(), z.string()]).nullable().default(null),
  point: z.number().nullable().default(null),
  completed_at: z.string().nullable().default(null),
  archived_at: z.string().nullable().default(null),
  is_draft: z.boolean().default(false),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
});

const planeCommentSchema = z.object({
  id: z.string(),
  comment_html: z.string().nullable().default(''),
  comment_stripped: z.string().nullable().default(''),
  actor: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
});

const planeLinkSchema = z.object({
  id: z.string(),
  title: z.string().nullable().default(''),
  url: z.string(),
});

const planePageSchema = z.object({
  id: z.string(),
  name: z.string().nullable().default('Untitled'),
  description_html: z.string().nullable().default(''),
  owned_by: z.string().nullable().default(null),
  access: z.number().default(0),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
  archived_at: z.string().nullable().default(null),
});

export type PlaneMember = z.infer<typeof planeMemberSchema>;
export type PlaneProject = z.infer<typeof planeProjectSchema>;
export type PlaneState = z.infer<typeof planeStateSchema>;
export type PlaneLabel = z.infer<typeof planeLabelSchema>;
export type PlaneCycle = z.infer<typeof planeCycleSchema>;
export type PlaneModule = z.infer<typeof planeModuleSchema>;
export type PlaneIssue = z.infer<typeof planeIssueSchema>;
export type PlaneComment = z.infer<typeof planeCommentSchema>;
export type PlaneLink = z.infer<typeof planeLinkSchema>;
export type PlanePage = z.infer<typeof planePageSchema>;

export interface PlaneProjectExport {
  readonly project: PlaneProject;
  readonly states: PlaneState[];
  readonly labels: PlaneLabel[];
  readonly cycles: PlaneCycle[];
  readonly modules: PlaneModule[];
  readonly members: PlaneMember[];
  readonly issues: PlaneIssue[];
  readonly cycleIssues: Record<string, string[]>;
  readonly moduleIssues: Record<string, string[]>;
  readonly comments: Record<string, PlaneComment[]>;
  readonly links: Record<string, PlaneLink[]>;
  readonly pages: PlanePage[];
}

export interface PlaneExport {
  readonly members: PlaneMember[];
  readonly projects: PlaneProjectExport[];
  readonly workspacePages: PlanePage[];
  readonly inaccessible: string[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readArray<T>(directory: string, name: string, schema: z.ZodType<T>): T[] {
  try {
    return z.array(schema).parse(readJson(resolve(directory, `${name}.json`)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function readRecord<T>(directory: string, name: string, schema: z.ZodType<T>): Record<string, T[]> {
  try {
    return z
      .record(z.string(), z.array(schema))
      .parse(readJson(resolve(directory, `${name}.json`)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function readInaccessible(root: string): string[] {
  try {
    return z.array(z.string()).parse(readJson(resolve(root, 'inaccessible.json')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function readPlaneExport(root: string): PlaneExport {
  const members = z.array(planeMemberSchema).parse(readJson(resolve(root, 'members.json')));
  const projectList = z.array(planeProjectSchema).parse(readJson(resolve(root, 'projects.json')));
  const workspacePages = readArray(root, 'workspace-pages', planePageSchema);
  const inaccessible = readInaccessible(root);

  const directories = new Set(
    readdirSync(root).filter((entry) => statSync(resolve(root, entry)).isDirectory()),
  );

  const missing = projectList
    .filter((project) => !directories.has(project.identifier))
    .map((project) => project.identifier)
    .filter((identifier) => !inaccessible.includes(identifier));

  if (missing.length > 0) {
    throw new Error(
      `The export is incomplete: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} ` +
        'listed in projects.json but has no cached directory. Re-run the exporter before importing.',
    );
  }

  const projects = projectList
    .filter((project) => directories.has(project.identifier))
    .map((project) => {
      const directory = resolve(root, project.identifier);
      return {
        project,
        states: readArray(directory, 'states', planeStateSchema),
        labels: readArray(directory, 'labels', planeLabelSchema),
        cycles: readArray(directory, 'cycles', planeCycleSchema),
        modules: readArray(directory, 'modules', planeModuleSchema),
        members: readArray(directory, 'members', planeMemberSchema),
        issues: readArray(directory, 'issues', planeIssueSchema),
        cycleIssues: z
          .record(z.string(), z.array(z.string()))
          .parse(readJson(resolve(directory, 'cycle-issues.json'))),
        moduleIssues: z
          .record(z.string(), z.array(z.string()))
          .parse(readJson(resolve(directory, 'module-issues.json'))),
        comments: readRecord(directory, 'comments', planeCommentSchema),
        links: readRecord(directory, 'links', planeLinkSchema),
        pages: readArray(directory, 'pages', planePageSchema),
      };
    });

  return { members, projects, workspacePages, inaccessible };
}
