import type { StateCategory } from '@orbit/shared';

export interface SeedUser {
  readonly handle: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'admin' | 'member' | 'contributor' | 'guest';
  readonly teams: readonly string[];
}

export const SEED_USERS: readonly SeedUser[] = [
  {
    handle: 'pulkit',
    name: 'Pulkit Sharma',
    email: 'pulkit@noveum.ai',
    role: 'admin',
    teams: ['ENG', 'DES', 'MKT'],
  },
  {
    handle: 'shashank',
    name: 'Shashank Agarwal',
    email: 'shashank@noveum.ai',
    role: 'admin',
    teams: ['ENG', 'MKT'],
  },
  {
    handle: 'aditi',
    name: 'Aditi Rao',
    email: 'aditi@noveum.ai',
    role: 'member',
    teams: ['ENG', 'DES'],
  },
  {
    handle: 'harkirat',
    name: 'Harkirat Singh',
    email: 'harkirat@noveum.ai',
    role: 'member',
    teams: ['MKT'],
  },
  {
    handle: 'tanzeela',
    name: 'Tanzeela Khan',
    email: 'tanzeela@noveum.ai',
    role: 'member',
    teams: ['ENG', 'DES'],
  },
  {
    handle: 'koushik',
    name: 'Koushik Reddy',
    email: 'koushik@noveum.ai',
    role: 'contributor',
    teams: ['ENG'],
  },
  {
    handle: 'om',
    name: 'Om Patel',
    email: 'om@noveum.ai',
    role: 'guest',
    teams: ['MKT'],
  },
];

export interface SeedTeam {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly icon: string;
}

export const SEED_TEAMS: readonly SeedTeam[] = [
  {
    key: 'ENG',
    name: 'Engineering',
    description: 'Platform, API, and infrastructure work.',
    color: '#5A63C8',
    icon: 'cpu',
  },
  {
    key: 'DES',
    name: 'Design',
    description: 'Product design, design system, and research.',
    color: '#B4654A',
    icon: 'palette',
  },
  {
    key: 'MKT',
    name: 'Marketing',
    description: 'Growth, content, and launches.',
    color: '#4CB782',
    icon: 'megaphone',
  },
];

export interface SeedState {
  readonly name: string;
  readonly category: StateCategory;
  readonly color: string;
}

export const SEED_STATES: readonly SeedState[] = [
  { name: 'Triage', category: 'triage', color: '#EB5D5D' },
  { name: 'Backlog', category: 'backlog', color: '#8B90A0' },
  { name: 'Todo', category: 'unstarted', color: '#A2A7B8' },
  { name: 'In Progress', category: 'started', color: '#F0A44B' },
  { name: 'In Review', category: 'review', color: '#4CB782' },
  { name: 'Done', category: 'completed', color: '#7B83EB' },
  { name: 'Canceled', category: 'canceled', color: '#6E7385' },
];

export const SEED_LABELS: readonly { name: string; color: string }[] = [
  { name: 'Bug', color: '#EB5D5D' },
  { name: 'Feature', color: '#7B83EB' },
  { name: 'Improvement', color: '#4EA7FC' },
  { name: 'Chore', color: '#8B90A0' },
  { name: 'Design', color: '#B4654A' },
  { name: 'Docs', color: '#4CB782' },
  { name: 'Performance', color: '#F0A44B' },
];

export interface SeedProject {
  readonly name: string;
  readonly summary: string;
  readonly status: 'backlog' | 'planned' | 'in_progress' | 'completed' | 'canceled';
  readonly health: 'on_track' | 'at_risk' | 'off_track' | 'no_update';
  readonly leadHandle: string;
  readonly teams: readonly string[];
  readonly milestones: readonly string[];
}

export const SEED_PROJECTS: readonly SeedProject[] = [
  {
    name: 'Realtime Sync Engine',
    summary: 'Local-first store with a websocket delta stream so every surface updates live.',
    status: 'in_progress',
    health: 'on_track',
    leadHandle: 'shashank',
    teams: ['ENG'],
    milestones: ['Delta protocol', 'Client store', 'Presence and typing'],
  },
  {
    name: 'Workspace Onboarding',
    summary: 'Passwordless sign in, organization creation, invites, and domain auto join.',
    status: 'in_progress',
    health: 'at_risk',
    leadHandle: 'aditi',
    teams: ['ENG', 'DES'],
    milestones: ['Auth flows', 'Invite lifecycle', 'Empty states'],
  },
  {
    name: 'Docs and Attachments',
    summary: 'Markdown docs, image and PDF previews, and object storage for every upload.',
    status: 'planned',
    health: 'no_update',
    leadHandle: 'tanzeela',
    teams: ['ENG', 'DES'],
    milestones: ['Editor', 'Upload pipeline', 'Public sharing'],
  },
  {
    name: 'Launch Campaign',
    summary: 'Positioning, landing page, and launch sequence for the public release.',
    status: 'planned',
    health: 'on_track',
    leadHandle: 'harkirat',
    teams: ['MKT'],
    milestones: ['Positioning', 'Landing page', 'Launch week'],
  },
];

export interface SeedIssue {
  readonly team: string;
  readonly title: string;
  readonly description: string;
  readonly state: string;
  readonly priority: number;
  readonly assignee: string | null;
  readonly labels: readonly string[];
  readonly estimate: number | null;
  readonly project: string | null;
  readonly milestone: string | null;
}

export const SEED_ISSUES: readonly SeedIssue[] = [
  {
    team: 'ENG',
    title: 'Fan out delta packets over a single websocket per client',
    description:
      'Every client should hold **one** multiplexed socket. The server filters by sync scope and batches actions inside a 50ms window.\n\n### Acceptance\n\n- [x] Scope authorization on connect\n- [x] 50ms coalescing window\n- [ ] Backpressure disconnects slow sockets',
    state: 'In Review',
    priority: 1,
    assignee: 'shashank',
    labels: ['Feature', 'Performance'],
    estimate: 5,
    project: 'Realtime Sync Engine',
    milestone: 'Delta protocol',
  },
  {
    team: 'ENG',
    title: 'Optimistic issue status changes should never flicker',
    description:
      'Moving a card writes to the local store first, then reconciles from the delta stream. If the server rejects the write we roll back and surface a toast.',
    state: 'In Progress',
    priority: 1,
    assignee: 'aditi',
    labels: ['Improvement'],
    estimate: 3,
    project: 'Realtime Sync Engine',
    milestone: 'Client store',
  },
  {
    team: 'ENG',
    title: 'Allocate issue identifiers atomically under concurrency',
    description:
      'Two people pressing `C` at the same moment must never receive the same identifier. Use a single `UPDATE ... RETURNING` against the team counter.',
    state: 'Done',
    priority: 2,
    assignee: 'shashank',
    labels: ['Bug'],
    estimate: 2,
    project: 'Realtime Sync Engine',
    milestone: 'Delta protocol',
  },
  {
    team: 'ENG',
    title: 'Presence should expire after 45 seconds of silence',
    description:
      'Presence is ephemeral and never touches Postgres. Expire stale viewers so avatars do not pile up on an issue nobody is reading.',
    state: 'Todo',
    priority: 3,
    assignee: 'koushik',
    labels: ['Improvement'],
    estimate: 2,
    project: 'Realtime Sync Engine',
    milestone: 'Presence and typing',
  },
  {
    team: 'ENG',
    title: 'Passkey sign in fails on Safari when no credential is registered',
    description:
      'Safari throws `NotAllowedError` instead of resolving empty. Catch it and fall back to the magic link field without showing an error.',
    state: 'In Progress',
    priority: 1,
    assignee: 'tanzeela',
    labels: ['Bug'],
    estimate: 3,
    project: 'Workspace Onboarding',
    milestone: 'Auth flows',
  },
  {
    team: 'ENG',
    title: 'Invite tokens must be single use and expire after 14 days',
    description:
      'Accepting an invite twice should be a no op that returns the existing membership rather than creating a duplicate row.',
    state: 'In Review',
    priority: 2,
    assignee: 'aditi',
    labels: ['Feature'],
    estimate: 3,
    project: 'Workspace Onboarding',
    milestone: 'Invite lifecycle',
  },
  {
    team: 'ENG',
    title: 'Domain auto join for verified workspace domains',
    description:
      'When an organization allow lists `noveum.ai`, anyone signing in with that domain joins as a member without an invite.',
    state: 'Todo',
    priority: 3,
    assignee: null,
    labels: ['Feature'],
    estimate: 5,
    project: 'Workspace Onboarding',
    milestone: 'Invite lifecycle',
  },
  {
    team: 'ENG',
    title: 'Presigned uploads should stream straight to object storage',
    description:
      'The API validates size and content type, then hands back a presigned target. Bytes never pass through the app server.',
    state: 'Backlog',
    priority: 2,
    assignee: 'koushik',
    labels: ['Feature'],
    estimate: 5,
    project: 'Docs and Attachments',
    milestone: 'Upload pipeline',
  },
  {
    team: 'ENG',
    title: 'Render PDF attachments inline with a page thumbnail rail',
    description:
      'Large PDFs should lazy load pages. Keep the first paint under 300ms by rendering a cached cover image first.',
    state: 'Backlog',
    priority: 3,
    assignee: null,
    labels: ['Feature', 'Performance'],
    estimate: 8,
    project: 'Docs and Attachments',
    milestone: 'Upload pipeline',
  },
  {
    team: 'ENG',
    title: 'Sanitize every markdown surface against XSS',
    description:
      'Issue descriptions, comments, and docs all run through one renderer. Strip scripts, iframes, inline handlers, and `javascript:` urls.',
    state: 'Done',
    priority: 1,
    assignee: 'shashank',
    labels: ['Bug'],
    estimate: 3,
    project: 'Docs and Attachments',
    milestone: 'Editor',
  },
  {
    team: 'ENG',
    title: 'Virtualize the issue list so 10k rows scroll at 60fps',
    description:
      'Fixed row height plus a windowing layer. Avoid layout thrash by never measuring inside the scroll handler.',
    state: 'Todo',
    priority: 2,
    assignee: 'tanzeela',
    labels: ['Performance'],
    estimate: 5,
    project: null,
    milestone: null,
  },
  {
    team: 'ENG',
    title: 'Command palette should query the local store only',
    description:
      'No network round trip when opening the palette. Search runs against the hydrated client cache so results appear within one frame.',
    state: 'Done',
    priority: 2,
    assignee: 'aditi',
    labels: ['Performance'],
    estimate: 3,
    project: null,
    milestone: null,
  },
  {
    team: 'ENG',
    title: 'Rebalance fractional sort orders when gaps collapse',
    description:
      'Repeated drags between the same pair eventually exhaust float precision. Rebalance the column when the gap drops below 0.0001.',
    state: 'Todo',
    priority: 3,
    assignee: 'koushik',
    labels: ['Chore'],
    estimate: 2,
    project: null,
    milestone: null,
  },
  {
    team: 'ENG',
    title: 'Notification quiet hours should respect the recipient timezone',
    description:
      'Deferred email must resume at the start of the next working window in the recipient local time, not server time.',
    state: 'In Progress',
    priority: 2,
    assignee: 'shashank',
    labels: ['Improvement'],
    estimate: 3,
    project: null,
    milestone: null,
  },
  {
    team: 'ENG',
    title: 'Expose the MCP server over streamable HTTP',
    description:
      'AI tooling should read and write issues through MCP with the same permission checks as the REST API.',
    state: 'Backlog',
    priority: 2,
    assignee: null,
    labels: ['Feature'],
    estimate: 8,
    project: null,
    milestone: null,
  },
  {
    team: 'ENG',
    title: 'Reconnect should replay missed deltas by sync id',
    description:
      'On reconnect, compare the local high water mark against the server and fetch the gap rather than refetching every list.',
    state: 'Triage',
    priority: 2,
    assignee: null,
    labels: ['Bug'],
    estimate: null,
    project: 'Realtime Sync Engine',
    milestone: 'Delta protocol',
  },
  {
    team: 'ENG',
    title: 'Audit log every permission relevant mutation',
    description: 'Role changes, invites, integration connects, and deletions all need an entry.',
    state: 'Backlog',
    priority: 4,
    assignee: null,
    labels: ['Chore'],
    estimate: 3,
    project: null,
    milestone: null,
  },
  {
    team: 'ENG',
    title: 'Drop the legacy polling endpoint',
    description: 'Superseded by the delta stream. Remove the route and its tests.',
    state: 'Canceled',
    priority: 4,
    assignee: 'koushik',
    labels: ['Chore'],
    estimate: 1,
    project: null,
    milestone: null,
  },
  {
    team: 'DES',
    title: 'Design the board card at three densities',
    description:
      'Compact, default, and comfortable. Identifier, title, labels, assignee, and estimate must stay legible at every density.',
    state: 'In Progress',
    priority: 2,
    assignee: 'tanzeela',
    labels: ['Design'],
    estimate: 3,
    project: 'Workspace Onboarding',
    milestone: 'Empty states',
  },
  {
    team: 'DES',
    title: 'Light theme contrast audit',
    description:
      'Muted text on surface must clear 4.5:1. Check every state color against both grounds.',
    state: 'In Review',
    priority: 2,
    assignee: 'aditi',
    labels: ['Design', 'Improvement'],
    estimate: 2,
    project: null,
    milestone: null,
  },
  {
    team: 'DES',
    title: 'Empty states should teach a keyboard shortcut',
    description:
      'Every empty list gets one line of guidance and the shortcut that fills it, the way the rest of the product teaches itself.',
    state: 'Todo',
    priority: 3,
    assignee: 'tanzeela',
    labels: ['Design'],
    estimate: 2,
    project: 'Workspace Onboarding',
    milestone: 'Empty states',
  },
  {
    team: 'DES',
    title: 'Motion spec: nothing over 200ms, transform and opacity only',
    description:
      'Document the durations and easings, and add a reduced motion rule that collapses everything to an instant swap.',
    state: 'Done',
    priority: 2,
    assignee: 'aditi',
    labels: ['Design'],
    estimate: 2,
    project: null,
    milestone: null,
  },
  {
    team: 'DES',
    title: 'Sidebar needs a collapsed rail with icon only navigation',
    description:
      'Below 1024px it becomes an overlay drawer. Keep the trigger reachable by keyboard.',
    state: 'Todo',
    priority: 3,
    assignee: null,
    labels: ['Design'],
    estimate: 3,
    project: null,
    milestone: null,
  },
  {
    team: 'DES',
    title: 'Avatar fallbacks should derive initials consistently',
    description:
      'One helper, used everywhere, so the same person never renders two different sets of initials.',
    state: 'Done',
    priority: 4,
    assignee: 'tanzeela',
    labels: ['Chore'],
    estimate: 1,
    project: null,
    milestone: null,
  },
  {
    team: 'DES',
    title: 'Explore a timeline layout for cycles',
    description: 'Week, month, and quarter zoom with a highlighted today column.',
    state: 'Backlog',
    priority: 4,
    assignee: null,
    labels: ['Design'],
    estimate: 5,
    project: null,
    milestone: null,
  },
  {
    team: 'MKT',
    title: 'Write the launch announcement',
    description:
      'Lead with speed and the fact that it is free. Three screenshots: board, issue detail, and the command palette.',
    state: 'In Progress',
    priority: 1,
    assignee: 'harkirat',
    labels: ['Docs'],
    estimate: 3,
    project: 'Launch Campaign',
    milestone: 'Positioning',
  },
  {
    team: 'MKT',
    title: 'Landing page: above the fold in under one second',
    description: 'Inline the critical CSS and defer everything else. No layout shift on load.',
    state: 'Todo',
    priority: 2,
    assignee: 'harkirat',
    labels: ['Performance'],
    estimate: 5,
    project: 'Launch Campaign',
    milestone: 'Landing page',
  },
  {
    team: 'MKT',
    title: 'Record a 90 second product walkthrough',
    description:
      'Create an issue, move it across the board, comment, and show it updating live in a second window.',
    state: 'Todo',
    priority: 2,
    assignee: 'om',
    labels: ['Docs'],
    estimate: 3,
    project: 'Launch Campaign',
    milestone: 'Launch week',
  },
  {
    team: 'MKT',
    title: 'Comparison page against the incumbents',
    description: 'Honest table. Where we are thinner, say so.',
    state: 'Backlog',
    priority: 3,
    assignee: null,
    labels: ['Docs'],
    estimate: 3,
    project: 'Launch Campaign',
    milestone: 'Positioning',
  },
  {
    team: 'MKT',
    title: 'Set up the changelog feed',
    description: 'Ship notes weekly. Each entry links the issues it closed.',
    state: 'Done',
    priority: 3,
    assignee: 'harkirat',
    labels: ['Docs'],
    estimate: 2,
    project: null,
    milestone: null,
  },
  {
    team: 'MKT',
    title: 'Draft onboarding email sequence',
    description: 'Three emails: welcome, invite your team, and a keyboard shortcut tour.',
    state: 'Triage',
    priority: 3,
    assignee: null,
    labels: ['Docs'],
    estimate: null,
    project: 'Launch Campaign',
    milestone: 'Launch week',
  },
  {
    team: 'MKT',
    title: 'Audit every string for the em dash character',
    description: 'House style uses commas, colons, or separate sentences. Nothing else.',
    state: 'Done',
    priority: 4,
    assignee: 'om',
    labels: ['Chore'],
    estimate: 1,
    project: null,
    milestone: null,
  },
];

export interface SeedComment {
  readonly issueTitle: string;
  readonly author: string;
  readonly body: string;
  readonly replies: readonly { author: string; body: string }[];
  readonly reactions: readonly { user: string; emoji: string }[];
}

export const SEED_COMMENTS: readonly SeedComment[] = [
  {
    issueTitle: 'Fan out delta packets over a single websocket per client',
    author: 'aditi',
    body: 'Does the 50ms window apply per organization or per connection? If it is per connection a large workspace could still get bursty.',
    replies: [
      {
        author: 'shashank',
        body: 'Per connection, but the dedupe keys on `(model, modelId, action)` so a bulk edit of 40 issues collapses to one packet.',
      },
      { author: 'aditi', body: 'That answers it. Nice.' },
    ],
    reactions: [
      { user: 'shashank', emoji: '👍' },
      { user: 'tanzeela', emoji: '🎉' },
    ],
  },
  {
    issueTitle: 'Optimistic issue status changes should never flicker',
    author: 'tanzeela',
    body: 'Confirmed the flicker was our own echo coming back through the stream. Suppressing deltas whose actor matches the local session fixes it.\n\n```ts\nif (action.actor.id === session.userId) return;\n```',
    replies: [{ author: 'aditi', body: 'Pushed that in the last commit, watching it now.' }],
    reactions: [{ user: 'pulkit', emoji: '🚀' }],
  },
  {
    issueTitle: 'Passkey sign in fails on Safari when no credential is registered',
    author: 'pulkit',
    body: 'Reproduced on Safari 18. It rejects rather than resolving with an empty credential list, so we should treat `NotAllowedError` as "no passkey here" and fall through quietly.',
    replies: [
      {
        author: 'tanzeela',
        body: 'Handling it in the client wrapper so every entry point gets the fallback.',
      },
    ],
    reactions: [{ user: 'shashank', emoji: '👀' }],
  },
  {
    issueTitle: 'Design the board card at three densities',
    author: 'aditi',
    body: 'Compact drops the estimate chip and shrinks the avatar to 16px. Everything else stays, otherwise scanning breaks.',
    replies: [],
    reactions: [
      { user: 'tanzeela', emoji: '👍' },
      { user: 'pulkit', emoji: '👍' },
    ],
  },
  {
    issueTitle: 'Write the launch announcement',
    author: 'harkirat',
    body: 'First draft is up. Opening line: **it is free, it is fast, and it updates the moment anyone else changes anything.**',
    replies: [
      { author: 'pulkit', body: 'Good. Lead with speed, then the price, then the realtime bit.' },
      { author: 'harkirat', body: 'Reordered.' },
    ],
    reactions: [{ user: 'om', emoji: '🎉' }],
  },
  {
    issueTitle: 'Allocate issue identifiers atomically under concurrency',
    author: 'shashank',
    body: 'Test fires 20 concurrent creates and asserts 20 distinct identifiers. Green on every run so far.',
    replies: [],
    reactions: [{ user: 'koushik', emoji: '✅' }],
  },
];

export interface SeedDoc {
  readonly title: string;
  readonly collection: string | null;
  readonly author: string;
  readonly content: string;
  readonly project?: string;
  readonly repoBinding?: { readonly repo: string; readonly path: string; readonly branch: string };
}

export const SEED_COLLECTIONS: readonly string[] = ['Engineering', 'Product', 'Runbooks'];

export const SEED_DOCS: readonly SeedDoc[] = [
  {
    title: 'Realtime delta protocol',
    collection: 'Engineering',
    author: 'shashank',
    repoBinding: { repo: 'noveum/orbit', path: 'docs/realtime.md', branch: 'main' },
    content:
      '# Realtime delta protocol\n\nEvery mutation writes to Postgres, bumps `sync_id`, and publishes a `SyncAction` to Redis. The realtime server fans it out to subscribed clients.\n\n## Action shape\n\n```ts\ntype SyncAction = {\n  syncId: number;\n  organizationId: string;\n  scopes: string[];\n  action: "insert" | "update" | "delete" | "archive" | "unarchive";\n  model: string;\n  modelId: string;\n  data: Record<string, unknown>;\n  actor: { type: "user" | "integration" | "agent" | "system"; id: string };\n  at: string;\n};\n```\n\n## Rules\n\n| Rule | Why |\n| --- | --- |\n| Batch inside 50ms | A bulk edit becomes one packet |\n| Dedupe by model and id | The newest write wins |\n| Filter by scope | A client never sees what it cannot read |\n| Suppress own echo | Optimistic writes must not flicker |\n\nPresence is ephemeral and never touches Postgres.',
  },
  {
    title: 'Keyboard shortcuts',
    collection: 'Product',
    author: 'aditi',
    content:
      '# Keyboard shortcuts\n\nOrbit is keyboard first. Every action with a shortcut prints it next to the control.\n\n## Global\n\n- `Cmd K` command palette\n- `?` this list\n- `C` new issue\n- `[` toggle the sidebar\n\n## Navigation\n\nPress `G` then a second key.\n\n- `G` `I` inbox\n- `G` `M` my issues\n- `G` `P` projects\n\n## On an issue\n\n- `A` assign, `I` assign to me\n- `S` status, `P` priority, `L` labels\n- `Cmd .` copy identifier',
  },
  {
    title: 'Local development runbook',
    collection: 'Runbooks',
    author: 'pulkit',
    content:
      '# Local development\n\n```bash\nbun install\ncp .env.example .env\nbun run infra:up\nbun run db:push\nbun run db:seed\nbun run dev\n```\n\n## Services\n\n| Service | Port |\n| --- | --- |\n| web | 3000 |\n| realtime | 3100 |\n| mcp | 3200 |\n| postgres | 5434 |\n| redis | 6380 |\n| minio | 9010 |\n\n> Email goes out through Resend only. Set `RESEND_API_KEY` and an `EMAIL_FROM` on a domain you have verified in Resend, or every send will fail.\n\n## Checks\n\n`bun run verify` runs lint, the comment policy, types, and tests. All four must be green before a pull request.',
  },
  {
    title: 'Sync engine launch plan',
    collection: null,
    project: 'Realtime Sync Engine',
    author: 'pulkit',
    content:
      '# Sync engine launch plan\n\nThe sync engine ships when a second browser sees every write without a reload.\n\n## Milestones\n\n| Milestone | Owner | State |\n| --- | --- | --- |\n| Delta contract frozen | Shashank | Done |\n| Fan out under load | Koushik | In progress |\n| Reconnect and replay | Aditi | Not started |\n\n## Exit checklist\n\n- [x] Deltas batch inside 50ms\n- [x] Scopes filter what a client can read\n- [ ] Reconnect replays the missed window\n- [ ] Presence survives a server restart',
  },
];
