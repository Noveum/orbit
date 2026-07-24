import { randomUUID } from 'node:crypto';
import type { StateCategory } from '@orbit/shared';
import { type AssetStore, inlineAssets } from './assets.ts';
import { isImportableComment } from './importable.ts';
import {
  isBotEmail,
  type LinearExport,
  type LinearState,
  linearStateCategory,
} from './linear-source.ts';
import { htmlToMarkdown } from './markdown.ts';
import { estimateFor, priorityFor, slugFor, stateCategoryFor } from './plane-mapping.ts';
import type { PlaneExport, PlaneProjectExport, PlaneState } from './plane-source.ts';
import { emptyRows, type ImportRows } from './rows.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

interface CanonicalState {
  readonly category: StateCategory;
  readonly name: string;
  readonly color: string;
}

const CANONICAL_STATES: readonly CanonicalState[] = [
  { category: 'triage', name: 'Triage', color: '#E5484D' },
  { category: 'backlog', name: 'Backlog', color: '#BEC2C8' },
  { category: 'unstarted', name: 'Todo', color: '#E2E2E2' },
  { category: 'started', name: 'In Progress', color: '#F2C94C' },
  { category: 'review', name: 'In Review', color: '#5E6AD2' },
  { category: 'completed', name: 'Done', color: '#4CB782' },
  { category: 'canceled', name: 'Canceled', color: '#95A2B3' },
];

interface TeamConfig {
  readonly key: string;
  readonly name: string;
}

const TEAMS: readonly TeamConfig[] = [
  { key: 'ENG', name: 'Engineering' },
  { key: 'MKT', name: 'Marketing' },
  { key: 'SALES', name: 'Sales' },
  { key: 'CUST', name: 'Customer' },
  { key: 'NOVEUM', name: 'Noveum AI' },
];

interface ProjectConfig {
  readonly key: string;
  readonly team: string;
  readonly name: string;
  readonly linear: readonly string[];
  readonly plane: readonly string[];
}

const PROJECTS: readonly ProjectConfig[] = [
  {
    key: 'apimkt-eng',
    team: 'ENG',
    name: 'API.market Engineering',
    linear: ['API.market Engineering'],
    plane: ['APIMKTENG'],
  },
  {
    key: 'noveum-eng',
    team: 'ENG',
    name: 'Noveum.ai Engineering',
    linear: ['Noveum.ai Engineering'],
    plane: [],
  },
  { key: 'ai-eng', team: 'ENG', name: 'AI Engineering', linear: ['AI Engineering'], plane: [] },
  { key: 'novasynth', team: 'ENG', name: 'NovaSynth', linear: ['NovaSynth'], plane: [] },
  { key: 'marketing', team: 'MKT', name: 'Marketing', linear: ['Marketing'], plane: ['MARKETING'] },
  {
    key: 'seo-sprint',
    team: 'MKT',
    name: 'API.Market SEO Sprint',
    linear: ['API.Market SEO Sprint'],
    plane: ['SEOSPRINT'],
  },
  {
    key: 'linkedin',
    team: 'MKT',
    name: 'API Market LinkedIn',
    linear: ['API Market LinkedIn Engagement'],
    plane: ['LNKDINMKT'],
  },
  { key: 'sales', team: 'SALES', name: 'Sales', linear: ['Sales'], plane: ['SALES'] },
  {
    key: 'customer-issues',
    team: 'CUST',
    name: 'Customer Issues',
    linear: ['Customer Issues'],
    plane: ['CUSTISSUES'],
  },
  {
    key: 'v1-plan',
    team: 'NOVEUM',
    name: 'Noveum.ai V1 Plan',
    linear: ['Noveum.ai V1 Plan'],
    plane: ['V1PLAN'],
  },
  {
    key: 'ai-team',
    team: 'NOVEUM',
    name: 'Noveum.ai AI Team',
    linear: ['Noveum.ai AI Team'],
    plane: [],
  },
  { key: 'noveum-demo', team: 'NOVEUM', name: 'Noveum AI', linear: [], plane: ['NOVEU'] },
];

const ORPHAN_TEAM = 'NOVEUM';

export interface CombineConfig {
  readonly organizationId: string;
  readonly now: Date;
  readonly assets: AssetStore;
  readonly singleTeam?: { key: string; name: string };
}

export interface CombineOutcome {
  readonly rows: ImportRows;
  readonly aliases: { id: string; organizationId: string; identifier: string; issueId: string }[];
  readonly stats: Record<string, number>;
  readonly flags: string[];
}

interface PreparedIssue {
  readonly sourceId: string;
  readonly orbitId: string;
  readonly source: 'linear' | 'plane';
  readonly teamKey: string;
  readonly projectKey: string | null;
  readonly category: StateCategory;
  readonly title: string;
  readonly description: string;
  readonly priority: number;
  readonly estimate: number | null;
  readonly assigneeEmail: string | null;
  readonly creatorEmail: string | null;
  readonly cycleRef: { kind: 'L' | 'P'; id: string } | null;
  readonly labels: { name: string; color: string }[];
  readonly parentSourceId: string | null;
  readonly originalIdentifier: string;
  readonly sortOrder: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly canceledAt: Date | null;
  readonly dueDate: string | null;
  readonly archivedAt: Date | null;
  readonly comments: {
    id: string;
    authorEmail: string | null;
    body: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
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
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isOpen(category: StateCategory): boolean {
  return category === 'triage' || category === 'backlog' || category === 'unstarted';
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function pickName(primary: string, secondary: string, email: string): string {
  if (primary && !primary.includes('@')) return primary;
  if (secondary && !secondary.includes('@')) return secondary;
  return email.split('@')[0] ?? email;
}

function orgRole(isGuest: boolean, isAdmin: boolean): string {
  if (isGuest) return 'guest';
  return isAdmin ? 'admin' : 'member';
}

function planeMemberRole(isBot: boolean, roleSlug: string): string {
  if (isBot) return 'guest';
  if (roleSlug === 'admin' || roleSlug === 'owner') return 'admin';
  if (roleSlug === 'guest') return 'guest';
  return 'member';
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one-shot import builder; the end-to-end pipeline reads clearer whole than split across many helpers
export function combine(
  linear: LinearExport,
  plane: PlaneExport,
  config: CombineConfig,
): CombineOutcome {
  const rows = emptyRows();
  const aliases: CombineOutcome['aliases'] = [];
  const flags: string[] = [];
  const org = config.organizationId;

  const teams = config.singleTeam ? [config.singleTeam] : TEAMS;
  const teamKeyFor = (cfg: ProjectConfig): string =>
    config.singleTeam ? config.singleTeam.key : cfg.team;
  const orphanTeamKey = config.singleTeam ? config.singleTeam.key : ORPHAN_TEAM;

  const createdCandidates = [
    ...linear.issues.map((issue) => issue.createdAt),
    ...linear.projects.map((project) => project.createdAt),
  ];
  const floor = createdCandidates.reduce<Date>((oldest, value) => {
    const parsed = at(value, config.now);
    return parsed < oldest ? parsed : oldest;
  }, config.now);

  const userByEmail = new Map<
    string,
    { userId: string; name: string; isBot: boolean; role: string }
  >();
  const linearIdToEmail = new Map<string, string>();
  const planeIdToEmail = new Map<string, string>();
  const takenHandles = new Set<string>();

  function rankRole(role: string): number {
    if (role === 'admin') return 3;
    return role === 'member' ? 2 : 1;
  }

  function handleFrom(seed: string): string {
    const base =
      seed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 28) || 'member';
    if (!takenHandles.has(base)) {
      takenHandles.add(base);
      return base;
    }
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!takenHandles.has(candidate)) {
        takenHandles.add(candidate);
        return candidate;
      }
    }
    return `${base}-${id().slice(0, 6)}`;
  }

  function upsertUser(email: string, name: string, isBot: boolean, role: string): string {
    const key = email.toLowerCase();
    const existing = userByEmail.get(key);
    if (existing !== undefined) {
      if (!isBot && existing.isBot) existing.isBot = false;
      if (rankRole(role) > rankRole(existing.role)) existing.role = role;
      if (!existing.name.includes(' ') && name.includes(' ')) existing.name = name;
      return existing.userId;
    }
    const userId = id();
    userByEmail.set(key, { userId, name, isBot, role });
    return userId;
  }

  for (const user of linear.users) {
    const email = user.email.toLowerCase();
    const bot = isBotEmail(email);
    const name = pickName(user.displayName, user.name, email);
    const role = orgRole(bot || user.guest, user.admin);
    upsertUser(email, name, bot, role);
    linearIdToEmail.set(user.id, email);
  }

  for (const member of plane.members) {
    const email = member.email.toLowerCase();
    const full = `${member.first_name} ${member.last_name}`.trim();
    const name = full || member.display_name || (email.split('@')[0] ?? email);
    const role = planeMemberRole(member.is_bot, member.role_slug);
    upsertUser(email, name, member.is_bot, role);
    planeIdToEmail.set(member.id, email);
  }

  let fallbackUserId = '';
  for (const [email, entry] of userByEmail) {
    rows.users.push({
      id: entry.userId,
      name: entry.name,
      email,
      emailVerified: true,
      image: null,
      handle: handleFrom(entry.name || email.split('@')[0] || 'member'),
      timezone: 'Asia/Kolkata',
      createdAt: floor,
      updatedAt: floor,
    });
    if (!entry.isBot) {
      rows.members.push({
        id: id(),
        organizationId: org,
        userId: entry.userId,
        role: entry.role,
        syncId: 0,
        createdAt: floor,
      });
      if (fallbackUserId === '' && email === 'pulkit@noveum.ai') fallbackUserId = entry.userId;
    }
  }
  if (fallbackUserId === '') {
    const firstMember = rows.members[0];
    fallbackUserId = firstMember?.userId ?? rows.users[0]?.id ?? '';
  }
  if (fallbackUserId === '') throw new Error('No users found to import.');

  function userIdForEmail(email: string | null): string | undefined {
    if (email === null) return undefined;
    return userByEmail.get(email.toLowerCase())?.userId;
  }

  const teamIdByKey = new Map<string, string>();
  const stateIdByTeamCategory = new Map<string, string>();
  for (const team of teams) {
    const teamId = id();
    teamIdByKey.set(team.key, teamId);
    rows.teams.push({
      id: teamId,
      organizationId: org,
      name: team.name,
      key: team.key,
      description: '',
      icon: 'circle',
      color: '#5A63C8',
      issueCounter: 0,
      syncId: 0,
      createdAt: floor,
      updatedAt: floor,
    });
    CANONICAL_STATES.forEach((state, position) => {
      const stateId = id();
      stateIdByTeamCategory.set(`${team.key}::${state.category}`, stateId);
      rows.states.push({
        id: stateId,
        organizationId: org,
        teamId,
        name: state.name,
        category: state.category,
        color: state.color,
        position,
        syncId: 0,
        createdAt: floor,
      });
    });
    for (const entry of userByEmail.values()) {
      if (entry.isBot) continue;
      rows.teamMembers.push({ id: id(), teamId, userId: entry.userId, createdAt: floor });
    }
  }

  const linearProjectById = new Map(linear.projects.map((project) => [project.id, project]));
  const canonicalByLinearName = new Map<string, ProjectConfig>();
  const canonicalByPlaneIdentifier = new Map<string, ProjectConfig>();
  for (const projectConfig of PROJECTS) {
    for (const name of projectConfig.linear)
      canonicalByLinearName.set(normalizeName(name), projectConfig);
    for (const identifier of projectConfig.plane)
      canonicalByPlaneIdentifier.set(identifier, projectConfig);
  }

  const projectIdByKey = new Map<string, string>();
  const projectSlugs = new Set<string>();
  function ensureProject(configEntry: ProjectConfig): string {
    const existing = projectIdByKey.get(configEntry.key);
    if (existing !== undefined) return existing;
    const projectId = id();
    projectIdByKey.set(configEntry.key, projectId);
    const teamId = teamIdByKey.get(teamKeyFor(configEntry));
    if (teamId === undefined) throw new Error(`Unknown team ${teamKeyFor(configEntry)}`);

    const linearMatch = linear.projects.find((project) =>
      configEntry.linear.some((name) => normalizeName(name) === normalizeName(project.name)),
    );
    const description = (linearMatch?.content || linearMatch?.description || '').trim();
    const leadEmail =
      linearMatch?.lead?.id === undefined ? undefined : linearIdToEmail.get(linearMatch.lead.id);

    rows.projects.push({
      id: projectId,
      organizationId: org,
      name: configEntry.name,
      slug: slugFor(configEntry.name, projectSlugs),
      summary: description.slice(0, 280),
      description,
      status: 'backlog',
      health: 'no_update',
      icon: 'box',
      color: '#5A63C8',
      leadId: (leadEmail === undefined ? null : userIdForEmail(leadEmail)) ?? null,
      startDate: day(linearMatch?.startDate ?? linearMatch?.createdAt ?? null),
      targetDate: day(linearMatch?.targetDate ?? null),
      sortOrder: 1024,
      syncId: 0,
      createdAt: at(linearMatch?.createdAt, floor),
      updatedAt: at(linearMatch?.updatedAt, floor),
      archivedAt: linearMatch?.archivedAt ? at(linearMatch.archivedAt, config.now) : null,
    });
    rows.projectTeams.push({ id: id(), projectId, teamId });
    return projectId;
  }

  const labelIdByTeamName = new Map<string, string>();
  function ensureLabel(teamKey: string, name: string, color: string): string {
    const key = `${teamKey}::${normalizeName(name)}`;
    const existing = labelIdByTeamName.get(key);
    if (existing !== undefined) return existing;
    const labelId = id();
    labelIdByTeamName.set(key, labelId);
    rows.labels.push({
      id: labelId,
      organizationId: org,
      teamId: teamIdByKey.get(teamKey) ?? null,
      name: name.trim() || 'label',
      color: color || '#8A8A99',
      syncId: 0,
      createdAt: floor,
    });
    return labelId;
  }

  const cycleNumbersByTeam = new Map<string, Set<number>>();
  const cycleIdByTeamRef = new Map<string, string>();
  const linearCycleById = new Map(linear.cycles.map((cycle) => [cycle.id, cycle]));

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: two source cycle shapes (Linear vs Plane) resolved inline
  function ensureCycle(teamKey: string, ref: { kind: 'L' | 'P'; id: string }): string | null {
    const key = `${teamKey}::${ref.kind}::${ref.id}`;
    const existing = cycleIdByTeamRef.get(key);
    if (existing !== undefined) return existing;
    const teamId = teamIdByKey.get(teamKey);
    if (teamId === undefined) return null;

    const used = cycleNumbersByTeam.get(teamKey) ?? new Set<number>();
    cycleNumbersByTeam.set(teamKey, used);

    let number: number;
    let name: string;
    let startsAt: Date;
    let endsAt: Date;
    let completedAt: Date | null;
    if (ref.kind === 'L') {
      const cycle = linearCycleById.get(ref.id);
      if (cycle === undefined) return null;
      number = cycle.number;
      name = cycle.name ?? `Cycle ${cycle.number}`;
      startsAt = at(cycle.startsAt ?? cycle.createdAt, floor);
      endsAt = at(cycle.endsAt, new Date(startsAt.getTime() + 14 * DAY_MS));
      if (cycle.completedAt) completedAt = at(cycle.completedAt, endsAt);
      else completedAt = endsAt < config.now ? endsAt : null;
    } else {
      const cycle = planeCycleById.get(ref.id);
      if (cycle === undefined) return null;
      let candidate = 1;
      while (used.has(candidate)) candidate += 1;
      number = candidate;
      name = cycle.name;
      startsAt = at(cycle.start_date ?? cycle.created_at, floor);
      endsAt = at(cycle.end_date, new Date(startsAt.getTime() + 14 * DAY_MS));
      completedAt = endsAt < config.now ? endsAt : null;
    }
    while (used.has(number)) number += 1;
    used.add(number);

    const cycleId = id();
    cycleIdByTeamRef.set(key, cycleId);
    rows.cycles.push({
      id: cycleId,
      organizationId: org,
      teamId,
      number,
      name,
      startsAt,
      endsAt,
      completedAt,
      syncId: 0,
      createdAt: floor,
    });
    return cycleId;
  }

  const planeCycleById = new Map<string, PlaneProjectExport['cycles'][number]>();
  for (const entry of plane.projects) {
    for (const cycle of entry.cycles) planeCycleById.set(cycle.id, cycle);
  }

  const prepared: PreparedIssue[] = [];
  const orphanTeamId = teamIdByKey.get(orphanTeamKey);
  if (orphanTeamId === undefined) throw new Error('Orphan team missing');

  const linearLabelById = new Map(linear.labels.map((label) => [label.id, label]));
  const linearStateById = new Map<string, LinearState>(
    linear.states.map((state) => [state.id, state]),
  );

  let orphanCount = 0;
  let unmappedLinearProjects = 0;
  for (const issue of linear.issues) {
    let projectKey: string | null = null;
    let teamKey = orphanTeamKey;
    if (issue.project?.id === undefined) {
      orphanCount += 1;
    } else {
      const project = linearProjectById.get(issue.project.id);
      const match = project ? canonicalByLinearName.get(normalizeName(project.name)) : undefined;
      if (match === undefined) {
        unmappedLinearProjects += 1;
      } else {
        projectKey = match.key;
        teamKey = teamKeyFor(match);
        ensureProject(match);
      }
    }

    const state = issue.state?.id === undefined ? undefined : linearStateById.get(issue.state.id);
    const category: StateCategory = state
      ? (linearStateCategory(state) as StateCategory)
      : 'backlog';
    const createdAt = at(issue.createdAt, floor);

    const comments = (linear.comments[issue.id] ?? [])
      .map((comment) => ({
        id: id(),
        authorEmail:
          comment.user?.id === undefined ? null : (linearIdToEmail.get(comment.user.id) ?? null),
        body: (comment.body ?? '').trim(),
        createdAt: at(comment.createdAt, createdAt),
        updatedAt: at(comment.updatedAt, at(comment.createdAt, createdAt)),
      }))
      .filter((comment) => comment.body.length > 0);

    prepared.push({
      sourceId: issue.id,
      orbitId: id(),
      source: 'linear',
      teamKey,
      projectKey,
      category,
      title: issue.title.slice(0, 500) || 'Untitled',
      description: (issue.description ?? '').trim(),
      priority: Math.max(0, Math.min(4, issue.priority)),
      estimate:
        issue.estimate !== null &&
        Number.isFinite(issue.estimate) &&
        issue.estimate >= 0 &&
        issue.estimate <= 32_767
          ? Math.trunc(issue.estimate)
          : null,
      assigneeEmail:
        issue.assignee?.id === undefined ? null : (linearIdToEmail.get(issue.assignee.id) ?? null),
      creatorEmail:
        issue.creator?.id === undefined ? null : (linearIdToEmail.get(issue.creator.id) ?? null),
      cycleRef: issue.cycle?.id === undefined ? null : { kind: 'L', id: issue.cycle.id },
      labels: issue.labels.nodes
        .map((node) => linearLabelById.get(node.id))
        .filter((label): label is NonNullable<typeof label> => label !== undefined)
        .map((label) => ({ name: label.name, color: label.color ?? '#8A8A99' })),
      parentSourceId: issue.parent?.id ?? null,
      originalIdentifier: issue.identifier,
      sortOrder: issue.sortOrder,
      createdAt,
      updatedAt: at(issue.updatedAt, createdAt),
      startedAt: isOpen(category) ? null : at(issue.startedAt, createdAt),
      completedAt: category === 'completed' ? at(issue.completedAt, createdAt) : null,
      canceledAt: category === 'canceled' ? at(issue.canceledAt, createdAt) : null,
      dueDate: day(issue.dueDate),
      archivedAt: issue.archivedAt ? at(issue.archivedAt, config.now) : null,
      comments,
    });
  }

  let skippedDrafts = 0;
  let unmappedPlaneProjects = 0;
  for (const entry of plane.projects) {
    const match = canonicalByPlaneIdentifier.get(entry.project.identifier);
    if (match === undefined) {
      unmappedPlaneProjects += 1;
      flags.push(`Plane project ${entry.project.identifier} has no canonical mapping; skipped.`);
      continue;
    }
    ensureProject(match);
    const planeStateById = new Map<string, PlaneState>(
      entry.states.map((state) => [state.id, state]),
    );
    const planeLabelById = new Map(entry.labels.map((label) => [label.id, label]));
    const cycleByIssue = new Map<string, string>();
    for (const [cycleId, issueIds] of Object.entries(entry.cycleIssues)) {
      for (const issueId of issueIds) cycleByIssue.set(issueId, cycleId);
    }

    for (const issue of entry.issues) {
      if (issue.is_draft) {
        skippedDrafts += 1;
        continue;
      }
      const state = planeStateById.get(issue.state);
      if (state === undefined) continue;
      const category = stateCategoryFor(state);
      const createdAt = at(issue.created_at, floor);
      const planeCycleId = issue.cycle_id ?? cycleByIssue.get(issue.id) ?? null;

      const links = entry.links[issue.id] ?? [];
      const orbitIssueId = id();
      let description = htmlToMarkdown(
        inlineAssets(
          issue.description_html ?? '',
          'issue',
          orbitIssueId,
          fallbackUserId,
          config.assets,
        ),
      );
      if (links.length > 0) {
        description = [
          description,
          '',
          '## Links',
          ...links.map((link) => `- [${link.title || link.url}](${link.url})`),
        ]
          .join('\n')
          .trim();
      }

      const comments = (entry.comments[issue.id] ?? [])
        .filter((comment) => isImportableComment(comment.comment_html))
        .map((comment) => {
          const commentId = id();
          return {
            id: commentId,
            authorEmail:
              comment.actor === null ? null : (planeIdToEmail.get(comment.actor) ?? null),
            body: htmlToMarkdown(
              inlineAssets(
                comment.comment_html,
                'comment',
                commentId,
                fallbackUserId,
                config.assets,
              ),
            ),
            createdAt: at(comment.created_at, createdAt),
            updatedAt: at(comment.updated_at, at(comment.created_at, createdAt)),
          };
        })
        .filter((comment) => comment.body.length > 0);

      const firstAssignee = issue.assignees
        .map((planeId) => planeIdToEmail.get(planeId))
        .find((email): email is string => email !== undefined);

      prepared.push({
        sourceId: issue.id,
        orbitId: orbitIssueId,
        source: 'plane',
        teamKey: teamKeyFor(match),
        projectKey: match.key,
        category,
        title: issue.name.slice(0, 500) || 'Untitled',
        description,
        priority: priorityFor(issue),
        estimate: estimateFor(issue),
        assigneeEmail: firstAssignee ?? null,
        creatorEmail:
          issue.created_by === null ? null : (planeIdToEmail.get(issue.created_by) ?? null),
        cycleRef: planeCycleId === null ? null : { kind: 'P', id: planeCycleId },
        labels: issue.labels
          .map((labelId) => planeLabelById.get(labelId))
          .filter((label): label is NonNullable<typeof label> => label !== undefined)
          .map((label) => ({ name: label.name, color: label.color ?? '#8A8A99' })),
        parentSourceId: issue.parent,
        originalIdentifier: `${entry.project.identifier}-${issue.sequence_id}`,
        sortOrder: issue.sort_order,
        createdAt,
        updatedAt: at(issue.updated_at, createdAt),
        startedAt: isOpen(category) ? null : createdAt,
        completedAt: category === 'completed' ? at(issue.completed_at, createdAt) : null,
        canceledAt: category === 'canceled' ? at(issue.completed_at, createdAt) : null,
        dueDate: day(issue.target_date),
        archivedAt: issue.archived_at === null ? null : at(issue.archived_at, config.now),
        comments,
      });
    }
  }

  const orbitIdBySource = new Map<string, string>();
  for (const item of prepared) orbitIdBySource.set(item.sourceId, item.orbitId);

  const byTeam = new Map<string, PreparedIssue[]>();
  for (const item of prepared) {
    const list = byTeam.get(item.teamKey) ?? [];
    list.push(item);
    byTeam.set(item.teamKey, list);
  }

  const liveIdentifiers = new Set<string>();

  for (const [teamKey, items] of byTeam) {
    const teamId = teamIdByKey.get(teamKey);
    if (teamId === undefined) continue;
    items.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    let number = 0;
    for (const item of items) {
      number += 1;
      const orbitIssueId = item.orbitId;
      const identifier = `${teamKey}-${number}`;
      liveIdentifiers.add(identifier);
      const stateId = stateIdByTeamCategory.get(`${teamKey}::${item.category}`) ?? '';
      const creatorId = userIdForEmail(item.creatorEmail) ?? fallbackUserId;
      const projectId =
        item.projectKey === null ? null : (projectIdByKey.get(item.projectKey) ?? null);
      const cycleId = item.cycleRef === null ? null : ensureCycle(teamKey, item.cycleRef);

      rows.issues.push({
        id: orbitIssueId,
        organizationId: org,
        teamId,
        number,
        identifier,
        title: item.title,
        description: item.description,
        stateId,
        priority: item.priority,
        creatorId,
        assigneeId: userIdForEmail(item.assigneeEmail) ?? null,
        projectId,
        milestoneId: null,
        cycleId,
        parentId:
          item.parentSourceId === null ? null : (orbitIdBySource.get(item.parentSourceId) ?? null),
        estimate: item.estimate,
        dueDate: item.dueDate,
        sortOrder: item.sortOrder,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        canceledAt: item.canceledAt,
        stateEnteredAt: item.updatedAt,
        syncId: 0,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        archivedAt: item.archivedAt,
      });

      aliases.push({
        id: id(),
        organizationId: org,
        identifier: item.originalIdentifier,
        issueId: orbitIssueId,
      });

      for (const label of item.labels) {
        const labelId = ensureLabel(teamKey, label.name, label.color);
        rows.issueLabels.push({ id: id(), issueId: orbitIssueId, labelId });
      }

      for (const comment of item.comments) {
        rows.comments.push({
          id: comment.id,
          organizationId: org,
          issueId: orbitIssueId,
          authorId: userIdForEmail(comment.authorEmail) ?? fallbackUserId,
          parentId: null,
          body: comment.body,
          editedAt: null,
          syncId: 0,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        });
      }
    }

    const team = rows.teams.find((row) => row.id === teamId);
    if (team !== undefined) team.issueCounter = number;
  }

  buildPlaneDocs(
    plane,
    projectIdByKey,
    canonicalByPlaneIdentifier,
    fallbackUserId,
    floor,
    org,
    config,
    rows,
  );

  const seenAlias = new Set<string>();
  const keptAliases = aliases.filter((alias) => {
    if (liveIdentifiers.has(alias.identifier)) return false;
    if (seenAlias.has(alias.identifier)) return false;
    seenAlias.add(alias.identifier);
    return true;
  });
  const droppedAliases = aliases.length - keptAliases.length;
  if (droppedAliases > 0) {
    flags.push(
      `${droppedAliases} original identifiers were not kept as aliases (they collide with new identifiers or duplicate another alias).`,
    );
  }

  const stats: Record<string, number> = {
    users: rows.users.length,
    members: rows.members.length,
    teams: rows.teams.length,
    states: rows.states.length,
    projects: rows.projects.length,
    labels: rows.labels.length,
    cycles: rows.cycles.length,
    issues: rows.issues.length,
    issueLabels: rows.issueLabels.length,
    comments: rows.comments.length,
    docs: rows.docs.length,
    aliases: keptAliases.length,
    linearIssues: linear.issues.length,
    orphanIssues: orphanCount,
    skippedPlaneDrafts: skippedDrafts,
  };
  if (orphanCount > 0)
    flags.push(
      `${orphanCount} Linear issues had no project; placed in team ${orphanTeamKey} with no project.`,
    );
  if (unmappedLinearProjects > 0)
    flags.push(
      `${unmappedLinearProjects} Linear issues referenced an unmapped project; placed in team ${orphanTeamKey}.`,
    );
  if (unmappedPlaneProjects > 0)
    flags.push(`${unmappedPlaneProjects} Plane projects were unmapped and skipped.`);

  return { rows, aliases: keptAliases, stats, flags };
}

function buildPlaneDocs(
  plane: PlaneExport,
  projectIdByKey: Map<string, string>,
  canonicalByPlaneIdentifier: Map<string, ProjectConfig>,
  fallbackUserId: string,
  floor: Date,
  org: string,
  config: CombineConfig,
  rows: ImportRows,
): void {
  function pushPages(
    pages: PlaneProjectExport['pages'],
    collectionName: string,
    projectId: string | null,
  ): void {
    if (pages.length === 0) return;
    const collectionId = id();
    rows.collections.push({
      id: collectionId,
      organizationId: org,
      name: collectionName,
      icon: 'book',
      createdAt: floor,
    });
    for (const page of pages) {
      const pageCreatedAt = at(page.created_at, floor);
      const docId = id();
      rows.docs.push({
        id: docId,
        organizationId: org,
        collectionId,
        projectId,
        title: page.name ?? 'Untitled',
        content: htmlToMarkdown(
          inlineAssets(page.description_html, 'doc', docId, fallbackUserId, config.assets),
        ),
        visibility: 'workspace',
        publishToken: null,
        authorId: fallbackUserId,
        repoBinding: null,
        syncId: 0,
        createdAt: pageCreatedAt,
        updatedAt: at(page.updated_at, pageCreatedAt),
        archivedAt: page.archived_at === null ? null : at(page.archived_at, config.now),
      });
    }
  }

  for (const entry of plane.projects) {
    const match = canonicalByPlaneIdentifier.get(entry.project.identifier);
    const projectId = match === undefined ? null : (projectIdByKey.get(match.key) ?? null);
    pushPages(entry.pages, entry.project.name, projectId);
  }
  pushPages(plane.workspacePages, 'Workspace', null);
}
