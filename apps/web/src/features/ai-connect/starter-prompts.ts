export const STARTER_KINDS = ['import', 'plan', 'repo'] as const;
export type StarterKind = (typeof STARTER_KINDS)[number];

export const IMPORT_SOURCES = [
  'linear',
  'trello',
  'asana',
  'notion',
  'clickup',
  'github',
  'jira',
  'spreadsheet',
  'other',
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const STARTER_LABELS: Record<StarterKind, { title: string; summary: string }> = {
  import: {
    title: 'Move my work in',
    summary: 'Bring tasks, projects and notes over from the tool you use today.',
  },
  plan: {
    title: 'Plan something new',
    summary: 'Brainstorm with your AI and turn the idea into projects, sprints and tasks.',
  },
  repo: {
    title: 'Backlog from my code',
    summary: 'Read a repository and its TODOs, then propose a backlog.',
  },
};

interface SourceGuide {
  readonly label: string;
  readonly reading: string;
}

export const IMPORT_SOURCE_GUIDES: Record<ImportSource, SourceGuide> = {
  linear: {
    label: 'Linear',
    reading:
      'Read my Linear teams, projects, cycles and open issues, through the Linear MCP server if it is connected, otherwise from a CSV export I attach.',
  },
  trello: {
    label: 'Trello',
    reading:
      'Read my Trello boards from a JSON export I attach. Lists become statuses and cards become tasks, with checklists folded into the description.',
  },
  asana: {
    label: 'Asana',
    reading:
      'Read my Asana projects from a CSV export I attach. Sections become statuses, subtasks become sub-issues.',
  },
  notion: {
    label: 'Notion',
    reading:
      'Read my Notion task databases and pages, through the Notion MCP server if it is connected, otherwise from an export I attach. Database rows become tasks and pages become docs.',
  },
  clickup: {
    label: 'ClickUp',
    reading:
      'Read my ClickUp spaces and lists from a CSV export I attach. Lists become projects and statuses map to the closest Orbit status.',
  },
  github: {
    label: 'GitHub Issues',
    reading:
      'Read the open issues and milestones of the GitHub repositories I name, with the gh CLI or the GitHub MCP server. Milestones become Orbit milestones.',
  },
  jira: {
    label: 'Jira',
    reading:
      'Read my Jira project from a CSV export or the Atlassian MCP server. Epics become projects and sprints become Orbit sprints.',
  },
  spreadsheet: {
    label: 'A spreadsheet',
    reading:
      'Read the spreadsheet or CSV I paste or attach. Ask me which columns hold the title, status, owner and due date before you map anything.',
  },
  other: {
    label: 'Something else',
    reading:
      'Ask me where my work lives today, then read whatever export, paste or connected tool I point you to.',
  },
};

const ORIENT = 'Call get_me, list_teams, list_states and list_labels so you know my workspace.';

function numbered(lines: readonly string[]): string {
  return lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
}

function importPrompt(source: ImportSource): string {
  const guide = IMPORT_SOURCE_GUIDES[source];
  const from = source === 'other' ? 'another tool' : guide.label;
  return [
    `I use Orbit as my task manager through its MCP server, and I want to move my work in from ${from}.`,
    '',
    numbered([
      ORIENT,
      guide.reading,
      'Before creating anything, show me a short plan: the teams, projects, labels and sprints you will create, and how many tasks go where. Wait for my OK.',
      'Create everything in Orbit: projects with create_project, tasks with create_issue (keep the title, description, status, priority, assignee and due date), sprints with create_cycle, and longer notes or specs with create_doc.',
      'Finish with a summary of what you created and anything you could not bring over.',
    ]),
  ].join('\n');
}

function planPrompt(): string {
  return [
    'Help me plan a new piece of work in Orbit, my task manager, through its MCP server.',
    '',
    numbered([
      ORIENT,
      'Interview me: what I am building or running, who is involved, what done looks like, and any deadlines. Ask one or two questions at a time and no more than eight in total.',
      'Propose a plan: a few projects, milestones for the key dates, two week sprints, and a first backlog of small, concrete tasks with priorities. Show it as an outline and wait for my OK.',
      'Create it with create_project, create_milestone, create_cycle and create_issue, and write the goals and scope into a doc with create_doc.',
      'Tell me the first three things to work on.',
    ]),
  ].join('\n');
}

function repoPrompt(): string {
  return [
    'Turn the code in this repository into a backlog in Orbit, my task manager, through its MCP server.',
    '',
    numbered([
      ORIENT,
      'Read the README, the docs, TODO and FIXME comments, recent commits and any open GitHub issues you can reach, to understand what is in progress and what is missing.',
      'Propose projects for the main areas and 15 to 30 concrete tasks, each with a priority and a short description that names the files involved. Wait for my OK.',
      'Create them with create_project and create_issue, and write a short architecture overview with create_doc.',
      'Summarize what you created.',
    ]),
  ].join('\n');
}

export function starterPrompt(kind: StarterKind, source: ImportSource = 'other'): string {
  if (kind === 'import') return importPrompt(source);
  if (kind === 'plan') return planPrompt();
  return repoPrompt();
}
