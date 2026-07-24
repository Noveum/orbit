export interface DocTemplate {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly content: string;
}

export const DOC_TEMPLATES: readonly DocTemplate[] = [
  {
    id: 'blank',
    name: 'Blank doc',
    title: 'Untitled doc',
    content: '# Untitled doc\n\nStart writing.\n',
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    title: 'Meeting notes',
    content: [
      '# Meeting notes',
      '',
      '**Note**',
      'Add the date, the attendees, and the one decision this meeting has to produce.',
      '',
      '## Agenda',
      '',
      '- ',
      '',
      '## Decisions',
      '',
      '- ',
      '',
      '## Actions',
      '',
      '- [ ] Owner: what, by when',
      '',
    ].join('\n'),
  },
  {
    id: 'product-spec',
    name: 'Product spec',
    title: 'Product spec',
    content: [
      '# Product spec',
      '',
      '## Problem',
      '',
      'Who hurts, how often, and what it costs them today.',
      '',
      '## Proposal',
      '',
      '## Out of scope',
      '',
      '## Rollout',
      '',
      '| Stage | Owner | Date |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
    ].join('\n'),
  },
  {
    id: 'runbook',
    name: 'Runbook',
    title: 'Runbook',
    content: [
      '# Runbook',
      '',
      '> **Warning**',
      '> Read the rollback step before you start.',
      '',
      '## Preconditions',
      '',
      '- [ ] ',
      '',
      '## Steps',
      '',
      '1. ',
      '',
      '## Rollback',
      '',
      '```bash',
      '# the exact command',
      '```',
      '',
    ].join('\n'),
  },
];

export function templateById(id: string | null): DocTemplate {
  const fallback = DOC_TEMPLATES[0] ?? {
    id: 'blank',
    name: 'Blank doc',
    title: 'Untitled doc',
    content: '',
  };
  if (id === null) return fallback;
  return DOC_TEMPLATES.find((template) => template.id === id) ?? fallback;
}
