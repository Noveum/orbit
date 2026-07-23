import type { StateCategory } from '@orbit/shared';
import type { PlaneIssue, PlaneMember, PlaneState } from './plane-source.ts';

export const TEAM_KEYS: Record<string, string> = {
  APIMKTENG: 'ENG',
  MARKETING: 'MKT',
  SALES: 'SALES',
  CUSTISSUES: 'CUST',
  SEOSPRINT: 'SEO',
  LNKDINMKT: 'LNKD',
  NOVEU: 'NOVEUM',
  V1PLAN: 'V1',
};

const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

export function teamKeyFor(identifier: string, taken: Set<string>): string {
  const mapped = TEAM_KEYS[identifier];
  const candidates = [
    mapped,
    identifier.slice(0, 6),
    identifier.replace(/[^A-Z0-9]/g, '').slice(0, 6),
  ].filter((value): value is string => value !== undefined && KEY_PATTERN.test(value));

  for (const candidate of candidates) {
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }

  const base = (candidates[0] ?? 'TEAM').slice(0, 5);
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (KEY_PATTERN.test(candidate) && !taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not derive a team key for ${identifier}.`);
}

const GROUP_CATEGORIES: Record<string, StateCategory> = {
  backlog: 'backlog',
  unstarted: 'unstarted',
  started: 'started',
  completed: 'completed',
  cancelled: 'canceled',
  canceled: 'canceled',
  triage: 'triage',
};

const REVIEW_NAMES = /\b(review|qa|verify|verification|testing|approval)\b/i;
const TRIAGE_NAMES = /\b(triage|intake|inbox|new)\b/i;

export function stateCategoryFor(state: PlaneState): StateCategory {
  if (state.is_triage) return 'triage';
  const base = GROUP_CATEGORIES[state.group.toLowerCase()] ?? 'backlog';
  if (base === 'started' && REVIEW_NAMES.test(state.name)) return 'review';
  if (base === 'backlog' && TRIAGE_NAMES.test(state.name)) return 'triage';
  return base;
}

const PRIORITIES: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
};

export function priorityFor(issue: PlaneIssue): number {
  return PRIORITIES[issue.priority.toLowerCase()] ?? 0;
}

export function estimateFor(issue: PlaneIssue): number | null {
  const raw = issue.point ?? issue.estimate_point;
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0 || value > 32_767) return null;
  return value;
}

export function displayNameFor(member: PlaneMember): string {
  const full = `${member.first_name} ${member.last_name}`.trim();
  if (full.length > 0) return dedupeWords(full);
  if (member.display_name.length > 0) return member.display_name;
  return member.email.split('@')[0] ?? member.email;
}

function dedupeWords(value: string): string {
  const words = value.split(/\s+/);
  const kept: string[] = [];
  for (const word of words) {
    if (kept.at(-1)?.toLowerCase() !== word.toLowerCase()) kept.push(word);
  }
  return kept.join(' ');
}

export function handleFor(member: PlaneMember, taken: Set<string>): string {
  const base =
    (member.display_name || member.email.split('@')[0] || 'member')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 28) || 'member';

  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not derive a handle for ${member.email}.`);
}

const ROLES: Record<string, string> = {
  owner: 'admin',
  admin: 'admin',
  member: 'member',
  guest: 'guest',
  viewer: 'guest',
  restricted: 'guest',
};

export function orgRoleFor(member: PlaneMember): string {
  if (member.is_bot) return 'guest';
  return ROLES[member.role_slug.toLowerCase()] ?? 'member';
}

export function slugFor(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'project';
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not derive a slug for ${name}.`);
}

export function projectStatusFor(
  issues: readonly PlaneIssue[],
  categories: ReadonlyMap<string, StateCategory>,
  archived: boolean,
): string {
  if (archived) return 'canceled';
  if (issues.length === 0) return 'backlog';
  const counts = { open: 0, started: 0, done: 0 };
  for (const issue of issues) {
    const category = categories.get(issue.state) ?? 'backlog';
    if (category === 'completed') counts.done += 1;
    else if (category === 'started' || category === 'review') counts.started += 1;
    else counts.open += 1;
  }
  if (counts.done === issues.length) return 'completed';
  if (counts.started > 0) return 'in_progress';
  if (counts.done > 0) return 'in_progress';
  return 'planned';
}
