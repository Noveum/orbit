export interface LabelDefinition {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

const TYPE_COLOR = 'd73a4a';
const ENHANCEMENT_COLOR = 'a2eeef';
const DOCS_COLOR = '0075ca';
const STATUS_COLOR = 'fbca04';
const BLOCKED_COLOR = 'b60205';
const AREA_COLOR = '5a63c8';
const COMMUNITY_COLOR = '7057ff';
const NEUTRAL_COLOR = 'cfd3d7';

export const LABELS: readonly LabelDefinition[] = [
  { name: 'bug', color: TYPE_COLOR, description: 'Something is broken' },
  {
    name: 'enhancement',
    color: ENHANCEMENT_COLOR,
    description: 'A new capability or an improvement to an existing one',
  },
  {
    name: 'documentation',
    color: DOCS_COLOR,
    description: 'Docs, the README, or anything that explains Orbit',
  },
  {
    name: 'refactor',
    color: 'bfd4f2',
    description: 'Changes the shape of the code without changing behaviour',
  },
  { name: 'performance', color: 'd4c5f9', description: 'Speed, memory, or bundle size' },
  {
    name: 'security',
    color: BLOCKED_COLOR,
    description: 'Security hardening. Never use this for an unreported vulnerability',
  },
  {
    name: 'accessibility',
    color: '0e8a16',
    description: 'Keyboard operation, screen readers, contrast, focus',
  },
  { name: 'tests', color: 'c2e0c6', description: 'Test coverage and test infrastructure' },
  { name: 'question', color: 'd876e3', description: 'Needs more information to act on' },

  {
    name: 'needs triage',
    color: STATUS_COLOR,
    description: 'Not yet looked at by a maintainer',
  },
  {
    name: 'needs reproduction',
    color: STATUS_COLOR,
    description: 'We cannot reproduce this yet',
  },
  {
    name: 'needs design',
    color: STATUS_COLOR,
    description: 'The shape has to be agreed before code is written',
  },
  {
    name: 'needs tests',
    color: STATUS_COLOR,
    description: 'Touches source without touching a test',
  },
  { name: 'ready', color: '0e8a16', description: 'Scoped, agreed, and safe to pick up' },
  { name: 'blocked', color: BLOCKED_COLOR, description: 'Waiting on something else' },
  {
    name: 'work in progress',
    color: NEUTRAL_COLOR,
    description: 'Not ready for review yet',
  },
  { name: 'stale', color: NEUTRAL_COLOR, description: 'No activity for a long time' },
  { name: 'duplicate', color: NEUTRAL_COLOR, description: 'Already tracked somewhere else' },
  { name: 'invalid', color: 'e4e669', description: 'Not a real problem, or not actionable' },
  { name: 'wontfix', color: 'ffffff', description: 'A deliberate decision not to do this' },
  {
    name: 'breaking change',
    color: BLOCKED_COLOR,
    description: 'Requires action from anyone self-hosting',
  },

  {
    name: 'p0 critical',
    color: BLOCKED_COLOR,
    description: 'Data loss, outage, or a security hole',
  },
  { name: 'p1 high', color: 'd93f0b', description: 'Blocks real work, fix this week' },
  { name: 'p2 medium', color: 'fbca04', description: 'Worth doing, not urgent' },
  { name: 'p3 low', color: NEUTRAL_COLOR, description: 'Nice to have' },

  { name: 'area: web', color: AREA_COLOR, description: 'The Next.js app and its UI' },
  {
    name: 'area: realtime',
    color: AREA_COLOR,
    description: 'The socket, the hub, scopes and fan-out',
  },
  { name: 'area: mcp', color: AREA_COLOR, description: 'The MCP server, its tools and its OAuth' },
  { name: 'area: database', color: AREA_COLOR, description: 'Schema, migrations, queries, seed' },
  { name: 'area: auth', color: AREA_COLOR, description: 'Sign-in, sessions, passkeys, OAuth' },
  {
    name: 'area: policy',
    color: AREA_COLOR,
    description: 'Roles, permissions and authorization',
  },
  { name: 'area: issues', color: AREA_COLOR, description: 'Issues, lists and boards' },
  { name: 'area: sprints', color: AREA_COLOR, description: 'Sprints, cycles and planning' },
  { name: 'area: docs-feature', color: AREA_COLOR, description: 'The docs product and its editor' },
  { name: 'area: integrations', color: AREA_COLOR, description: 'GitHub, Slack and webhooks' },
  { name: 'area: landing', color: AREA_COLOR, description: 'The marketing and landing pages' },
  { name: 'ci', color: AREA_COLOR, description: 'Workflows, tooling and repo automation' },
  { name: 'dependencies', color: '0366d6', description: 'Dependency updates' },

  {
    name: 'good first issue',
    color: COMMUNITY_COLOR,
    description: 'Small, well scoped, with the file paths written down',
  },
  {
    name: 'help wanted',
    color: '008672',
    description: 'We would love a hand with this one',
  },
  { name: 'roadmap', color: '5319e7', description: 'A tracked item on the public roadmap' },
  { name: 'epic', color: '5319e7', description: 'A large piece of work made of several issues' },
  {
    name: 'pinned',
    color: NEUTRAL_COLOR,
    description: 'Exempt from the stale bot',
  },
];
