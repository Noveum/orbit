import { randomUUID } from 'node:crypto';
import { STATE_CATEGORY_ORDER, type StateCategory } from '@orbit/shared';
import { type AssetStore, inlineAssets } from './assets.ts';
import { htmlToMarkdown } from './markdown.ts';
import {
  estimateFor,
  priorityFor,
  projectStatusFor,
  slugFor,
  stateCategoryFor,
  teamKeyFor,
} from './plane-mapping.ts';
import type { PlaneProjectExport } from './plane-source.ts';
import type { ImportRows } from './rows.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BuildContext {
  readonly organizationId: string;
  readonly userIdByPlaneId: ReadonlyMap<string, string>;
  readonly fallbackUserId: string;
  readonly teamKeys: Set<string>;
  readonly projectSlugs: Set<string>;
  readonly now: Date;
  readonly floor: Date;
  readonly assets: AssetStore;
}

export interface ProjectOutcome {
  readonly skippedDrafts: number;
}

function id(): string {
  return randomUUID();
}

function at(value: string | null | undefined, fallback: Date): Date {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function day(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function userFor(context: BuildContext, planeId: string | null | undefined): string | undefined {
  if (typeof planeId !== 'string') return undefined;
  return context.userIdByPlaneId.get(planeId);
}

function buildStates(
  entry: PlaneProjectExport,
  teamId: string,
  createdAt: Date,
  context: BuildContext,
  rows: ImportRows,
): { stateIds: Map<string, string>; categories: Map<string, StateCategory> } {
  const stateIds = new Map<string, string>();
  const categories = new Map<string, StateCategory>();
  const usedNames = new Set<string>();

  const ordered = [...entry.states].sort((left, right) => {
    const byCategory =
      STATE_CATEGORY_ORDER[stateCategoryFor(left)] - STATE_CATEGORY_ORDER[stateCategoryFor(right)];
    return byCategory === 0 ? left.sequence - right.sequence : byCategory;
  });

  ordered.forEach((state, position) => {
    const stateId = id();
    const category = stateCategoryFor(state);
    stateIds.set(state.id, stateId);
    categories.set(state.id, category);

    let name = state.name.trim() || category;
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      name = `${state.name.trim() || category} ${suffix}`;
      suffix += 1;
    }
    usedNames.add(name.toLowerCase());

    rows.states.push({
      id: stateId,
      organizationId: context.organizationId,
      teamId,
      name,
      category,
      color: state.color,
      position,
      syncId: 0,
      createdAt: at(state.created_at, createdAt),
    });
  });

  return { stateIds, categories };
}

function buildLabels(
  entry: PlaneProjectExport,
  teamId: string,
  createdAt: Date,
  context: BuildContext,
  rows: ImportRows,
): Map<string, string> {
  const labelIds = new Map<string, string>();
  for (const label of entry.labels) {
    const labelId = id();
    labelIds.set(label.id, labelId);
    rows.labels.push({
      id: labelId,
      organizationId: context.organizationId,
      teamId,
      name: label.name,
      color: label.color ?? '#8A8A99',
      syncId: 0,
      createdAt: at(label.created_at, createdAt),
    });
  }
  return labelIds;
}

function buildCycles(
  entry: PlaneProjectExport,
  teamId: string,
  createdAt: Date,
  context: BuildContext,
  rows: ImportRows,
): Map<string, string> {
  const cycleIds = new Map<string, string>();
  const ordered = [...entry.cycles].sort(
    (left, right) =>
      at(left.start_date ?? left.created_at, createdAt).getTime() -
      at(right.start_date ?? right.created_at, createdAt).getTime(),
  );

  ordered.forEach((cycle, index) => {
    const cycleId = id();
    cycleIds.set(cycle.id, cycleId);
    const startsAt = at(cycle.start_date ?? cycle.created_at, createdAt);
    const endsAt = at(cycle.end_date, new Date(startsAt.getTime() + 14 * DAY_MS));
    rows.cycles.push({
      id: cycleId,
      organizationId: context.organizationId,
      teamId,
      number: index + 1,
      name: cycle.name,
      startsAt,
      endsAt,
      completedAt: endsAt < context.now ? endsAt : null,
      syncId: 0,
      createdAt: at(cycle.created_at, createdAt),
    });
  });

  return cycleIds;
}

function buildMilestones(
  entry: PlaneProjectExport,
  projectId: string,
  createdAt: Date,
  context: BuildContext,
  rows: ImportRows,
): Map<string, string> {
  const milestoneIds = new Map<string, string>();
  entry.modules.forEach((module, index) => {
    const milestoneId = id();
    milestoneIds.set(module.id, milestoneId);
    rows.milestones.push({
      id: milestoneId,
      organizationId: context.organizationId,
      projectId,
      name: module.name,
      description: module.description ?? '',
      targetDate: day(module.target_date),
      sortOrder: (index + 1) * 1024,
      syncId: 0,
      createdAt: at(module.created_at, createdAt),
    });
  });
  return milestoneIds;
}

function invert(
  groups: Record<string, string[]>,
  ids: ReadonlyMap<string, string>,
): Map<string, string> {
  const byIssue = new Map<string, string>();
  for (const [groupId, issueIds] of Object.entries(groups)) {
    const mapped = ids.get(groupId);
    if (mapped === undefined) continue;
    for (const issueId of issueIds) byIssue.set(issueId, mapped);
  }
  return byIssue;
}

function descriptionFor(
  entry: PlaneProjectExport,
  planeIssueId: string,
  html: string,
  orbitIssueId: string,
  creatorId: string,
  store: AssetStore,
): string {
  const links = entry.links[planeIssueId] ?? [];
  const body = [htmlToMarkdown(inlineAssets(html, 'issue', orbitIssueId, creatorId, store))];
  if (links.length > 0) {
    body.push('', '## Links', ...links.map((link) => `- [${link.title || link.url}](${link.url})`));
  }
  return body.join('\n').trim();
}

interface IssueContext {
  readonly teamId: string;
  readonly key: string;
  readonly projectId: string;
  readonly createdAt: Date;
  readonly stateIds: ReadonlyMap<string, string>;
  readonly categories: ReadonlyMap<string, StateCategory>;
  readonly labelIds: ReadonlyMap<string, string>;
  readonly cycleIds: ReadonlyMap<string, string>;
  readonly milestoneIds: ReadonlyMap<string, string>;
}

interface IssueLinks {
  readonly issueIds: ReadonlyMap<string, string>;
  readonly cycleByIssue: ReadonlyMap<string, string>;
  readonly milestoneByIssue: ReadonlyMap<string, string>;
}

function pushIssue(
  issue: PlaneProjectExport['issues'][number],
  entry: PlaneProjectExport,
  issueContext: IssueContext,
  linked: IssueLinks,
  context: BuildContext,
  rows: ImportRows,
): string {
  const orbitIssueId = linked.issueIds.get(issue.id) ?? id();
  const creatorId = userFor(context, issue.created_by) ?? context.fallbackUserId;
  const category = issueContext.categories.get(issue.state) ?? 'backlog';
  const createdAt = at(issue.created_at, issueContext.createdAt);
  const open = category === 'backlog' || category === 'unstarted' || category === 'triage';
  const assigneeId = issue.assignees
    .map((planeId) => userFor(context, planeId))
    .find((value): value is string => value !== undefined);
  const cycleId =
    (issue.cycle_id === null ? undefined : issueContext.cycleIds.get(issue.cycle_id)) ??
    linked.cycleByIssue.get(issue.id) ??
    null;

  rows.issues.push({
    id: orbitIssueId,
    organizationId: context.organizationId,
    teamId: issueContext.teamId,
    number: issue.sequence_id,
    identifier: `${issueContext.key}-${issue.sequence_id}`,
    title: issue.name.slice(0, 500),
    description: descriptionFor(
      entry,
      issue.id,
      issue.description_html ?? '',
      orbitIssueId,
      creatorId,
      context.assets,
    ),
    stateId: issueContext.stateIds.get(issue.state) ?? '',
    priority: priorityFor(issue),
    creatorId,
    assigneeId: assigneeId ?? null,
    projectId: issueContext.projectId,
    milestoneId: linked.milestoneByIssue.get(issue.id) ?? null,
    cycleId,
    parentId: issue.parent === null ? null : (linked.issueIds.get(issue.parent) ?? null),
    estimate: estimateFor(issue),
    dueDate: day(issue.target_date),
    sortOrder: issue.sort_order,
    startedAt: open ? null : createdAt,
    completedAt: category === 'completed' ? at(issue.completed_at, createdAt) : null,
    canceledAt: category === 'canceled' ? at(issue.completed_at, createdAt) : null,
    stateEnteredAt: at(issue.updated_at, createdAt),
    syncId: 0,
    createdAt,
    updatedAt: at(issue.updated_at, createdAt),
    archivedAt: issue.archived_at === null ? null : at(issue.archived_at, context.now),
  });

  return orbitIssueId;
}

function pushComments(
  planeIssueId: string,
  orbitIssueId: string,
  fallbackDate: Date,
  entry: PlaneProjectExport,
  context: BuildContext,
  rows: ImportRows,
): void {
  for (const comment of entry.comments[planeIssueId] ?? []) {
    const commentId = id();
    const authorId = userFor(context, comment.actor) ?? context.fallbackUserId;
    const body = htmlToMarkdown(
      inlineAssets(comment.comment_html, 'comment', commentId, authorId, context.assets),
    );
    if (body.length === 0) continue;
    const createdAt = at(comment.created_at, fallbackDate);
    rows.comments.push({
      id: commentId,
      organizationId: context.organizationId,
      issueId: orbitIssueId,
      authorId,
      parentId: null,
      body,
      editedAt: null,
      syncId: 0,
      createdAt,
      updatedAt: at(comment.updated_at, createdAt),
    });
  }
}

function buildIssues(
  entry: PlaneProjectExport,
  issueContext: IssueContext,
  context: BuildContext,
  rows: ImportRows,
): number {
  let skippedDrafts = 0;
  const importable = entry.issues.filter((issue) => {
    if (issue.is_draft) {
      skippedDrafts += 1;
      return false;
    }
    return issueContext.stateIds.has(issue.state);
  });

  const issueIds = new Map<string, string>();
  for (const issue of importable) issueIds.set(issue.id, id());

  const linked: IssueLinks = {
    issueIds,
    cycleByIssue: invert(entry.cycleIssues, issueContext.cycleIds),
    milestoneByIssue: invert(entry.moduleIssues, issueContext.milestoneIds),
  };

  for (const issue of importable) {
    const orbitIssueId = pushIssue(issue, entry, issueContext, linked, context, rows);
    const createdAt = at(issue.created_at, issueContext.createdAt);

    for (const planeLabelId of issue.labels) {
      const labelId = issueContext.labelIds.get(planeLabelId);
      if (labelId === undefined) continue;
      rows.issueLabels.push({ id: id(), issueId: orbitIssueId, labelId });
    }

    pushComments(issue.id, orbitIssueId, createdAt, entry, context, rows);
  }

  return skippedDrafts;
}

export function buildDocs(
  pages: PlaneProjectExport['pages'],
  collectionName: string,
  projectId: string | null,
  createdAt: Date,
  context: BuildContext,
  rows: ImportRows,
): void {
  if (pages.length === 0) return;
  const collectionId = id();
  rows.collections.push({
    id: collectionId,
    organizationId: context.organizationId,
    name: collectionName,
    icon: 'book',
    createdAt,
  });

  for (const page of pages) {
    const pageCreatedAt = at(page.created_at, createdAt);
    rows.docs.push({
      id: id(),
      organizationId: context.organizationId,
      collectionId,
      projectId,
      title: page.name ?? 'Untitled',
      content: htmlToMarkdown(page.description_html),
      visibility: 'workspace',
      publishToken: null,
      authorId: userFor(context, page.owned_by) ?? context.fallbackUserId,
      repoBinding: null,
      syncId: 0,
      createdAt: pageCreatedAt,
      updatedAt: at(page.updated_at, pageCreatedAt),
      archivedAt: page.archived_at === null ? null : at(page.archived_at, context.now),
    });
  }
}

export function buildProject(
  entry: PlaneProjectExport,
  context: BuildContext,
  rows: ImportRows,
): ProjectOutcome {
  const { project } = entry;
  const teamId = id();
  const projectId = id();
  const key = teamKeyFor(project.identifier, context.teamKeys);
  const createdAt = at(project.created_at, context.floor);
  const archivedAt = project.archived_at === null ? null : at(project.archived_at, context.now);

  rows.teams.push({
    id: teamId,
    organizationId: context.organizationId,
    name: project.name,
    key,
    description: project.description ?? '',
    icon: 'circle',
    color: '#5A63C8',
    issueCounter: entry.issues.reduce((top, issue) => Math.max(top, issue.sequence_id), 0),
    syncId: 0,
    createdAt,
    updatedAt: at(project.updated_at, createdAt),
    archivedAt,
  });

  const seenMembers = new Set<string>();
  for (const member of entry.members) {
    const userId = context.userIdByPlaneId.get(member.id);
    if (userId === undefined || seenMembers.has(userId)) continue;
    seenMembers.add(userId);
    rows.teamMembers.push({ id: id(), teamId, userId, createdAt });
  }

  const { stateIds, categories } = buildStates(entry, teamId, createdAt, context, rows);
  const labelIds = buildLabels(entry, teamId, createdAt, context, rows);

  rows.projects.push({
    id: projectId,
    organizationId: context.organizationId,
    name: project.name,
    slug: slugFor(project.name, context.projectSlugs),
    summary: (project.description ?? '').slice(0, 280),
    description: project.description ?? '',
    status: projectStatusFor(entry.issues, categories, archivedAt !== null),
    health: 'no_update',
    icon: 'box',
    color: '#5A63C8',
    leadId: userFor(context, project.project_lead) ?? null,
    startDate: day(project.created_at),
    targetDate: null,
    sortOrder: 1024,
    syncId: 0,
    createdAt,
    updatedAt: at(project.updated_at, createdAt),
    archivedAt,
  });

  rows.projectTeams.push({ id: id(), projectId, teamId });

  const cycleIds = buildCycles(entry, teamId, createdAt, context, rows);
  const milestoneIds = buildMilestones(entry, projectId, createdAt, context, rows);

  const skippedDrafts = buildIssues(
    entry,
    { teamId, key, projectId, createdAt, stateIds, categories, labelIds, cycleIds, milestoneIds },
    context,
    rows,
  );

  buildDocs(entry.pages, project.name, projectId, createdAt, context, rows);

  return { skippedDrafts };
}
